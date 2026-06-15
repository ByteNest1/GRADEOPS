import os
import io
import json
from typing import List, Optional
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv(dotenv_path=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

from backend.app.services.ocr_service import OCRService
from backend.app.services.grading_agent import GradingAgent
from backend.app.models.schemas import Rubric, ExamCreate, GradeResponse
from backend.app.core.database import (
    init_db, get_exams, get_exam, create_exam, 
    get_submissions, create_submission, update_submission_status
)

# Initialize Database on startup
init_db()

app = FastAPI(title="GRADEOPS API")

# Allow communication from our React frontend development server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Setup uploads directory
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")


# Define payloads
class ApprovePayload(BaseModel):
    score: float
    justification: str

@app.get("/api/exams")
async def list_exams():
    try:
        return get_exams()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/exams")
async def create_new_exam(exam: ExamCreate):
    try:
        rubric_items = [{"criteria": item.criteria, "max_points": item.max_points} for item in exam.rubric_items]
        create_exam(exam.id, exam.name, rubric_items)
        return {"status": "success", "message": f"Exam '{exam.name}' created/updated successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/submissions")
async def list_submissions(exam_id: Optional[str] = None, status: Optional[str] = None):
    try:
        return get_submissions(exam_id, status)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/upload-bulk")
async def upload_bulk(
    exam_id: str = Form(...),
    files: List[UploadFile] = File(...)
):
    # Fetch Exam and Rubric
    exam = get_exam(exam_id)
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
        
    rubric = Rubric(**exam["rubric"])
    
    agent = GradingAgent()
    processed_count = 0
    
    for file in files:
        filename = file.filename
        file_bytes = await file.read()
        
        # Clean student name from file name
        base_name, ext = os.path.splitext(filename)
        student_name = base_name.replace("_", " ").replace("-", " ").title()
        
        ext = ext.lower()
        
        if ext == ".pdf":
            # If PDF, we can use pypdf to split pages (so each page is treated as a sheet/submission)
            try:
                from pypdf import PdfReader, PdfWriter
                pdf_reader = PdfReader(io.BytesIO(file_bytes))
                total_pages = len(pdf_reader.pages)
                
                for i in range(total_pages):
                    writer = PdfWriter()
                    writer.add_page(pdf_reader.pages[i])
                    
                    page_bytes_io = io.BytesIO()
                    writer.write(page_bytes_io)
                    page_bytes = page_bytes_io.getvalue()
                    
                    sheet_student_name = f"{student_name} (Page {i+1})"
                    sheet_filename = f"{base_name}_page_{i+1}.pdf"
                    save_path = os.path.join(UPLOAD_DIR, sheet_filename)
                    
                    with open(save_path, "wb") as f:
                        f.write(page_bytes)
                        
                    relative_url = f"/uploads/{sheet_filename}"
                    
                    # Extract text
                    extracted_text = await OCRService.extract_text_from_image(page_bytes, "application/pdf")
                    
                    # Grade
                    grade_res = await agent.run(extracted_text, rubric, sheet_student_name)
                    
                    # Save to DB
                    create_submission(
                        exam_id=exam_id,
                        student_name=sheet_student_name,
                        file_path=relative_url,
                        extracted_text=extracted_text,
                        proposed_score=grade_res.proposed_score,
                        justification=grade_res.justification,
                        plagiarism_flag=grade_res.plagiarism_flag,
                        plagiarized_with=None # Will be filled if similarity check fails
                    )
                    processed_count += 1
            except Exception as e:
                print(f"Error parsing PDF file {filename}: {e}")
                # Fallback to grading as single document
                save_path = os.path.join(UPLOAD_DIR, filename)
                with open(save_path, "wb") as f:
                    f.write(file_bytes)
                relative_url = f"/uploads/{filename}"
                extracted_text = await OCRService.extract_text_from_image(file_bytes, "application/pdf")
                grade_res = await agent.run(extracted_text, rubric, student_name)
                create_submission(
                    exam_id=exam_id,
                    student_name=student_name,
                    file_path=relative_url,
                    extracted_text=extracted_text,
                    proposed_score=grade_res.proposed_score,
                    justification=grade_res.justification,
                    plagiarism_flag=grade_res.plagiarism_flag
                )
                processed_count += 1
        elif ext in [".png", ".jpg", ".jpeg", ".webp"]:
            # Single image submission
            save_path = os.path.join(UPLOAD_DIR, filename)
            with open(save_path, "wb") as f:
                f.write(file_bytes)
            relative_url = f"/uploads/{filename}"
            
            mime_type = "image/png" if ext == ".png" else "image/jpeg"
            extracted_text = await OCRService.extract_text_from_image(file_bytes, mime_type)
            grade_res = await agent.run(extracted_text, rubric, student_name)
            
            create_submission(
                exam_id=exam_id,
                student_name=student_name,
                file_path=relative_url,
                extracted_text=extracted_text,
                proposed_score=grade_res.proposed_score,
                justification=grade_res.justification,
                plagiarism_flag=grade_res.plagiarism_flag
            )
            processed_count += 1
        else:
            # Skip unhandled formats
            print(f"Skipping file {filename}: Unsupported extension.")
            
    return {"status": "success", "message": f"Successfully processed {processed_count} submissions."}

@app.post("/api/submissions/{sub_id}/approve")
async def approve_submission(sub_id: int, payload: ApprovePayload):
    try:
        update_submission_status(
            sub_id=sub_id, 
            status="approved", 
            final_score=payload.score, 
            final_justification=payload.justification
        )
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/submissions/{sub_id}/flag")
async def flag_submission(sub_id: int):
    try:
        update_submission_status(sub_id=sub_id, status="flagged")
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))