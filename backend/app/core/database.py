import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "gradeops.db")

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Create exams table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS exams (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
    )
    """)
    
    # Create rubrics table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS rubrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        exam_id TEXT NOT NULL,
        criteria TEXT NOT NULL,
        max_points REAL NOT NULL,
        FOREIGN KEY (exam_id) REFERENCES exams (id) ON DELETE CASCADE
    )
    """)
    
    # Create submissions table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS submissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        exam_id TEXT NOT NULL,
        student_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        extracted_text TEXT NOT NULL,
        proposed_score REAL NOT NULL,
        justification TEXT NOT NULL,
        plagiarism_flag INTEGER NOT NULL DEFAULT 0,
        plagiarized_with TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        final_score REAL,
        final_justification TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (exam_id) REFERENCES exams (id) ON DELETE CASCADE
    )
    """)
    
    conn.commit()
    conn.close()

# Helper database operations
def create_exam(exam_id: str, name: str, rubric_items: list):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("INSERT OR REPLACE INTO exams (id, name) VALUES (?, ?)", (exam_id, name))
        cursor.execute("DELETE FROM rubrics WHERE exam_id = ?", (exam_id,))
        for item in rubric_items:
            cursor.execute(
                "INSERT INTO rubrics (exam_id, criteria, max_points) VALUES (?, ?, ?)",
                (exam_id, item["criteria"], item["max_points"])
            )
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        conn.close()

def get_exams():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM exams")
    exams = [dict(row) for row in cursor.fetchall()]
    
    # Add rubric items to each exam
    for exam in exams:
        cursor.execute("SELECT criteria, max_points FROM rubrics WHERE exam_id = ?", (exam["id"],))
        exam["rubric"] = {"exam_id": exam["id"], "items": [dict(row) for row in cursor.fetchall()]}
    conn.close()
    return exams

def get_exam(exam_id: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM exams WHERE id = ?", (exam_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        return None
    exam = dict(row)
    cursor.execute("SELECT criteria, max_points FROM rubrics WHERE exam_id = ?", (exam_id,))
    exam["rubric"] = {"exam_id": exam_id, "items": [dict(row) for row in cursor.fetchall()]}
    conn.close()
    return exam

def create_submission(exam_id: str, student_name: str, file_path: str, extracted_text: str, proposed_score: float, justification: str, plagiarism_flag: bool = False, plagiarized_with: str = None):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO submissions (exam_id, student_name, file_path, extracted_text, proposed_score, justification, plagiarism_flag, plagiarized_with, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    """, (exam_id, student_name, file_path, extracted_text, proposed_score, justification, int(plagiarism_flag), plagiarized_with))
    sub_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return sub_id

def get_submissions(exam_id: str = None, status: str = None):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    query = "SELECT * FROM submissions"
    params = []
    
    conditions = []
    if exam_id:
        conditions.append("exam_id = ?")
        params.append(exam_id)
    if status:
        conditions.append("status = ?")
        params.append(status)
        
    if conditions:
        query += " WHERE " + " AND ".join(conditions)
        
    query += " ORDER BY id DESC"
    
    cursor.execute(query, params)
    rows = cursor.fetchall()
    submissions = [dict(row) for row in rows]
    conn.close()
    return submissions

def update_submission_status(sub_id: int, status: str, final_score: float = None, final_justification: str = None):
    conn = get_db_connection()
    cursor = conn.cursor()
    if final_score is not None and final_justification is not None:
        cursor.execute("""
        UPDATE submissions 
        SET status = ?, final_score = ?, final_justification = ? 
        WHERE id = ?
        """, (status, final_score, final_justification, sub_id))
    else:
        cursor.execute("""
        UPDATE submissions 
        SET status = ? 
        WHERE id = ?
        """, (status, sub_id))
    conn.commit()
    conn.close()
