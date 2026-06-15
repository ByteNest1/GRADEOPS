from pydantic import BaseModel
from typing import List, Optional

class RubricItem(BaseModel):
    criteria: str
    max_points: float

class Rubric(BaseModel):
    exam_id: str
    items: List[RubricItem]

class GradeResponse(BaseModel):
    proposed_score: float
    justification: str
    plagiarism_flag: bool

class ExamCreate(BaseModel):
    id: str
    name: str
    rubric_items: List[RubricItem]