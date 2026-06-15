import os
from google import genai
from backend.app.core.database import get_db_connection

def dot_product(v1, v2):
    return sum(x * y for x, y in zip(v1, v2))

def magnitude(v):
    return sum(x * x for x in v) ** 0.5

def cosine_similarity(v1, v2):
    mag1 = magnitude(v1)
    mag2 = magnitude(v2)
    if mag1 == 0 or mag2 == 0:
        return 0.0
    return dot_product(v1, v2) / (mag1 * mag2)

class PlagiarismService:
    @staticmethod
    def check_plagiarism(exam_id: str, current_student: str, current_text: str, similarity_threshold: float = 0.88):
        """
        Compare the current student's answer against all other submissions of the same exam.
        Returns (is_plagiarized, match_details)
        """
        # If the student answer is very short, don't run plagiarism check
        if not current_text or len(current_text.strip()) < 15:
            return False, None

        # Fetch other submissions for the same exam
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT student_name, extracted_text FROM submissions WHERE exam_id = ? AND student_name != ?",
            (exam_id, current_student)
        )
        others = cursor.fetchall()
        conn.close()

        if not others:
            return False, None

        # Initialize GenAI Client to get embeddings
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            return False, None
        
        try:
            client = genai.Client(api_key=api_key)
            
            # Embed the current text
            response = client.models.embed_content(
                model="text-embedding-004",
                contents=current_text,
            )
            current_embedding = response.embeddings[0].values
            
            highest_similarity = 0.0
            most_similar_student = None
            
            # Embed other submissions and compare
            for other in others:
                other_student = other["student_name"]
                other_text = other["extracted_text"]
                
                if not other_text or len(other_text.strip()) < 15:
                    continue
                    
                other_response = client.models.embed_content(
                    model="text-embedding-004",
                    contents=other_text,
                )
                other_embedding = other_response.embeddings[0].values
                
                sim = cosine_similarity(current_embedding, other_embedding)
                if sim > highest_similarity:
                    highest_similarity = sim
                    most_similar_student = other_student
            
            if highest_similarity >= similarity_threshold:
                return True, f"Highly similar to {most_similar_student}'s answer (similarity: {highest_similarity:.2f})"
                
        except Exception as e:
            print(f"Error during plagiarism checking: {e}")
            
        return False, None
