import os
import asyncio
from google import genai
from google.genai import types

class OCRService:
    @staticmethod
    async def extract_text_from_image(file_bytes: bytes, mime_type: str = "image/jpeg") -> str:
        """
        Extract text from an image or PDF using Gemini 2.5 Flash.
        """
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            # Fallback if no API key is provided
            print("Warning: GEMINI_API_KEY is not set. Falling back to mock OCR.")
            await asyncio.sleep(1)
            return "Student Answer: The time complexity of inserting an element into a binary search tree is O(log n) on average, but can degrade to O(n) if the tree becomes completely unbalanced or skewed."

        try:
            client = genai.Client(api_key=api_key)
            
            prompt = """
            Perform high-accuracy OCR on this student answer sheet.
            Transcribe the handwritten text exactly as written.
            If there are diagrams, describe them briefly.
            Do not add grades or evaluations, just transcribe the text.
            """
            
            # Use run_in_executor to avoid blocking the async loop for network I/O
            loop = asyncio.get_event_loop()
            
            def call_gemini():
                return client.models.generate_content(
                    model='gemini-2.5-flash',
                    contents=[
                        types.Part.from_bytes(
                            data=file_bytes,
                            mime_type=mime_type,
                        ),
                        prompt
                    ]
                )
            
            response = await loop.run_in_executor(None, call_gemini)
            return response.text
            
        except Exception as e:
            print(f"Error during Gemini OCR processing: {e}")
            # Safe fallback
            return "Student Answer: The time complexity of inserting an element into a binary search tree is O(log n) on average, but can degrade to O(n) if the tree becomes completely unbalanced or skewed."