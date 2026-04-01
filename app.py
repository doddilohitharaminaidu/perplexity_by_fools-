import os
import sqlite3
import json
import requests
from flask import Flask, request as flask_request, jsonify, send_from_directory
from flask_cors import CORS
import google.generativeai as genai
from dotenv import load_dotenv
from bs4 import BeautifulSoup
from PyPDF2 import PdfReader
import uuid

# Load environment variables
load_dotenv()

app = Flask(__name__, static_folder='.', static_url_path='')
CORS(app)

# Configure Gemini API
api_key = os.environ.get("GEMINI_API_KEY")
if not api_key:
    print("Warning: GEMINI_API_KEY is not set in the environment.")

genai.configure(api_key=api_key)

model_name = 'gemini-2.5-flash'

SYSTEM_INSTRUCTION = """You are a helpful AI assistant powered by web search (RAG). 
When web search context is provided, use it to give accurate, up-to-date answers and cite the sources naturally.
IMPORTANT FORMATTING RULES:
- NEVER use LaTeX delimiters like $, $$, \\( \\), \\[ \\] for math.
- For exponents, write them as: x^2, e^x, 2^10, or use HTML like x<sup>2</sup>.
- For subscripts, write them as: H2O, x_1, or use HTML like H<sub>2</sub>O.
- For fractions, write them as: 1/2, (a+b)/(c+d).
- For square roots, write: sqrt(x), cbrt(x).
- Use standard Markdown for formatting (bold, italic, code blocks, lists, headers).
- Keep responses clean, readable, and free of any LaTeX syntax."""

try:
    model = genai.GenerativeModel(model_name, system_instruction=SYSTEM_INSTRUCTION)
except Exception as e:
    print(f"Failed to initialize model {model_name}: {e}")
    model = genai.GenerativeModel('gemini-2.5-flash', system_instruction=SYSTEM_INSTRUCTION)

# ============================
# Database Initialization
# ============================
def init_db():
    conn = sqlite3.connect('chat_history.db')
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS threads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            thread_id INTEGER,
            role TEXT,
            content TEXT,
            sources TEXT DEFAULT '[]',
            FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
        )
    """)
    conn.commit()
    conn.close()

init_db()

# ============================
# RAG: DuckDuckGo API + Page Scraping
# ============================
def fetch_page_content(url, max_chars=1500):
    """Fetch and extract meaningful text content from a URL."""
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
        resp = requests.get(url, headers=headers, timeout=5)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, 'html.parser')
        
        for tag in soup(['script', 'style', 'nav', 'footer', 'header', 'aside', 'form']):
            tag.decompose()
        
        texts = []
        for element in soup.find_all(['p', 'h1', 'h2', 'h3', 'li']):
            text = element.get_text(strip=True)
            if len(text) > 30:
                texts.append(text)
        
        content = '\n'.join(texts)
        return content[:max_chars] if content else ""
    except Exception as e:
        return ""

def perform_rag_search(query):
    """Perform web search via DuckDuckGo Instant Answer API + related topics."""
    sources = []
    context_parts = []
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
    
    try:
        # DuckDuckGo Instant Answer API
        resp = requests.get('https://api.duckduckgo.com/', params={
            'q': query,
            'format': 'json',
            'no_html': '1',
            'skip_disambig': '1'
        }, headers=headers, timeout=8)
        resp.raise_for_status()
        data = resp.json()
        
        count = 0
        
        # Main abstract (Wikipedia summary)
        abstract_text = data.get('AbstractText', '')
        abstract_url = data.get('AbstractURL', '')
        abstract_source = data.get('AbstractSource', 'Wikipedia')
        
        if abstract_text and abstract_url:
            # Try to get more content from the actual page
            page_content = fetch_page_content(abstract_url)
            full_content = page_content if page_content else abstract_text
            
            context_parts.append(
                f"[Source {count+1}] {abstract_source}\n"
                f"URL: {abstract_url}\n"
                f"Content: {full_content}\n"
            )
            sources.append({"title": abstract_source, "url": abstract_url})
            count += 1
        
        # Related topics
        for topic in data.get('RelatedTopics', []):
            if count >= 3:
                break
            
            if isinstance(topic, dict) and topic.get('Text'):
                text = topic.get('Text', '')
                first_url = topic.get('FirstURL', '')
                
                if first_url and 'duckduckgo.com' in first_url:
                    # Internal DDG link, skip scraping but use the text
                    title = text.split(' - ')[0] if ' - ' in text else text[:50]
                    context_parts.append(
                        f"[Source {count+1}] {title}\n"
                        f"Content: {text}\n"
                    )
                    sources.append({"title": title, "url": first_url})
                    count += 1
                elif first_url:
                    page_content = fetch_page_content(first_url)
                    snippet = page_content if page_content else text
                    title = text.split(' - ')[0] if ' - ' in text else text[:50]
                    context_parts.append(
                        f"[Source {count+1}] {title}\n"
                        f"URL: {first_url}\n"
                        f"Content: {snippet}\n"
                    )
                    sources.append({"title": title, "url": first_url})
                    count += 1
        
        # If we still have no results, try the Answer field
        answer = data.get('Answer', '')
        if not context_parts and answer:
            context_parts.append(f"[Instant Answer] {answer}\n")
            
    except Exception as e:
        print(f"RAG Search Error: {e}")
    
    context_str = ""
    if context_parts:
        context_str = "RETRIEVED WEB CONTEXT:\n\n" + "\n---\n".join(context_parts)
    
    return sources, context_str

# ============================
# Routes
# ============================
@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

def get_db():
    conn = sqlite3.connect('chat_history.db')
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/api/threads', methods=['GET'])
def get_threads():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM threads ORDER BY created_at DESC LIMIT 50")
    threads = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return jsonify({'threads': threads})

@app.route('/api/threads/<int:thread_id>', methods=['GET'])
def get_thread(thread_id):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM messages WHERE thread_id = ? ORDER BY id ASC", (thread_id,))
    messages = [dict(row) for row in cursor.fetchall()]
    conn.close()
    for msg in messages:
        try:
            msg['sources'] = json.loads(msg.get('sources', '[]'))
        except:
            msg['sources'] = []
    return jsonify({'messages': messages})

@app.route('/api/threads/<int:thread_id>', methods=['DELETE'])
def delete_thread(thread_id):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM messages WHERE thread_id = ?", (thread_id,))
    cursor.execute("DELETE FROM threads WHERE id = ?", (thread_id,))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


# ============================
# PDF Upload & Storage
# ============================
UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# In-memory store: thread_id -> list of PDF text chunks
pdf_contexts = {}

def extract_pdf_text(filepath):
    """Extract all text from a PDF file using PyPDF2."""
    text_parts = []
    try:
        reader = PdfReader(filepath)
        for i, page in enumerate(reader.pages):
            page_text = page.extract_text()
            if page_text and page_text.strip():
                text_parts.append(f"[Page {i+1}]\n{page_text.strip()}")
        print(f"  [PDF] Extracted {len(text_parts)} pages of text")
    except Exception as e:
        print(f"  [PDF] Error extracting text: {e}")
    return "\n\n".join(text_parts)

@app.route('/api/upload', methods=['POST'])
def upload_pdf():
    """Upload a PDF and extract its text content."""
    if 'file' not in flask_request.files:
        return jsonify({'error': 'No file provided'}), 400
    
    file = flask_request.files['file']
    if not file.filename:
        return jsonify({'error': 'No file selected'}), 400
    
    if not file.filename.lower().endswith('.pdf'):
        return jsonify({'error': 'Only PDF files are supported'}), 400
    
    thread_id = flask_request.form.get('thread_id')
    
    # Save the file
    safe_name = f"{uuid.uuid4().hex}_{file.filename}"
    filepath = os.path.join(UPLOAD_FOLDER, safe_name)
    file.save(filepath)
    print(f"  [PDF] Saved: {safe_name}")
    
    # Extract text
    pdf_text = extract_pdf_text(filepath)
    
    if not pdf_text:
        return jsonify({'error': 'Could not extract text from the PDF. It might be image-based or encrypted.'}), 400
    
    # Store context keyed by thread_id (or 'pending' for new threads)
    context_key = str(thread_id) if thread_id else 'pending'
    if context_key not in pdf_contexts:
        pdf_contexts[context_key] = []
    pdf_contexts[context_key].append({
        'filename': file.filename,
        'text': pdf_text[:15000],  # Cap at 15k chars to fit in LLM context
        'pages': len(PdfReader(filepath).pages)
    })
    
    page_count = len(PdfReader(filepath).pages)
    char_count = len(pdf_text)
    
    return jsonify({
        'ok': True,
        'filename': file.filename,
        'pages': page_count,
        'chars': min(char_count, 15000),
        'context_key': context_key
    })

@app.route('/api/chat', methods=['POST'])
def chat():
    data = flask_request.json
    if not data or 'prompt' not in data:
        return jsonify({'error': 'No prompt provided'}), 400
    
    user_prompt = data['prompt']
    thread_id = data.get('thread_id')
    history = data.get('history', [])
    
    conn = get_db()
    cursor = conn.cursor()

    if not thread_id:
        title = user_prompt[:50] + ("..." if len(user_prompt) > 50 else "")
        cursor.execute("INSERT INTO threads (title) VALUES (?)", (title,))
        thread_id = cursor.lastrowid
        conn.commit()

    cursor.execute("INSERT INTO messages (thread_id, role, content) VALUES (?, 'user', ?)", (thread_id, user_prompt))
    conn.commit()
    
    # RAG: DuckDuckGo API + Page scraping
    print(f"  [RAG] Searching for: {user_prompt[:50]}...")
    sources, context_str = perform_rag_search(user_prompt)
    print(f"  [RAG] Found {len(sources)} sources")
    
    # Check for PDF context
    pdf_context_str = ""
    # Check both specific thread and pending
    for key in [str(thread_id), 'pending']:
        if key in pdf_contexts and pdf_contexts[key]:
            for pdf_doc in pdf_contexts[key]:
                pdf_context_str += f"\n\n=== UPLOADED PDF: {pdf_doc['filename']} ({pdf_doc['pages']} pages) ===\n{pdf_doc['text']}\n=== END PDF ===\n"
            # Move pending to thread_id if needed
            if key == 'pending' and str(thread_id) != 'pending':
                pdf_contexts[str(thread_id)] = pdf_contexts.pop('pending')
    
    if pdf_context_str and context_str:
        augmented_prompt = (
            f"The user asked: \"{user_prompt}\"\n\n"
            f"{context_str}\n\n"
            f"{pdf_context_str}\n\n"
            f"Using both the web context AND the uploaded PDF content above, provide a comprehensive answer. "
            f"Cite sources by number for web results. Reference the PDF content when relevant."
        )
    elif pdf_context_str:
        augmented_prompt = (
            f"The user asked: \"{user_prompt}\"\n\n"
            f"{pdf_context_str}\n\n"
            f"Using the uploaded PDF content above, provide a comprehensive, accurate answer. "
            f"Reference specific sections, pages, or data from the PDF when relevant."
        )
    elif context_str:
        augmented_prompt = (
            f"The user asked: \"{user_prompt}\"\n\n"
            f"{context_str}\n\n"
            f"Using the retrieved web context above, provide a comprehensive, accurate answer. "
            f"Cite sources by number when using specific information from them."
        )
    else:
        augmented_prompt = user_prompt

    try:
        if history:
            chat_session = model.start_chat(history=history)
            response = chat_session.send_message(augmented_prompt)
        else:
            response = model.generate_content(augmented_prompt)
        
        text_response = response.text
        
        cursor.execute(
            "INSERT INTO messages (thread_id, role, content, sources) VALUES (?, 'model', ?, ?)", 
            (thread_id, text_response, json.dumps(sources))
        )
        conn.commit()
        
        return jsonify({
            'response': text_response, 
            'thread_id': thread_id,
            'sources': sources
        })
    except Exception as e:
        error_msg = str(e)
        print(f"Error generating content: {error_msg}")
        return jsonify({'error': f"Model error: {error_msg}"}), 500
    finally:
        conn.close()

if __name__ == '__main__':
    print("=" * 50)
    print("  Perplexity AI Clone - Server Running")
    print("  Local:   http://127.0.0.1:8000")
    print("  Network: http://0.0.0.0:8000")
    print("=" * 50)
    app.run(debug=True, host='0.0.0.0', port=8000)
