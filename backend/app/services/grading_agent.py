import os
import json
from typing import TypedDict, List, Optional
from google import genai
from google.genai import types
from pydantic import BaseModel
from langgraph.graph import StateGraph, END
from backend.app.models.schemas import Rubric, GradeResponse
from backend.app.services.plagiarism_service import PlagiarismService

# Schema for structured LLM evaluation of an individual criterion
class CriterionEvaluation(BaseModel):
    score_awarded: float
    rationale: str

# Define the shared state object passed across nodes
class AgentState(TypedDict):
    student_answer: str
    student_name: str
    rubric: Rubric
    scores_pool: List[float]
    justifications: List[str]
    plagiarism_flag: bool
    plagiarism_details: Optional[str]
    final_output: Optional[GradeResponse]

class GradingAgent:
    def __init__(self):
        # Initialize the official Gemini Client (automatically reads GEMINI_API_KEY from environment)
        api_key = os.getenv("GEMINI_API_KEY")
        self.client = genai.Client(api_key=api_key)
        
        # Build the state graph workflow
        workflow = StateGraph(AgentState)
        
        # Register processing nodes
        workflow.add_node("evaluate_criteria", self.node_evaluate_criteria)
        workflow.add_node("security_audit", self.node_security_audit)
        
        # Establish execution edges
        workflow.set_entry_point("evaluate_criteria")
        workflow.add_edge("evaluate_criteria", "security_audit")
        workflow.add_edge("security_audit", END)
        
        self.app = workflow.compile()

    def node_evaluate_criteria(self, state: AgentState) -> AgentState:
        """Node 1: Uses structured LLM generation to score each rubric item independently."""
        student_text = state["student_answer"]
        rubric = state["rubric"]
        
        # Reset lists just in case
        state["scores_pool"] = []
        state["justifications"] = []
        
        for item in rubric.items:
            # Construct a highly targeted prompt for this specific grading boundary
            prompt = f"""
            You are an expert university Teaching Assistant grading an exam.
            
            Student Submission Text:
            \"\"\"{student_text}\"\"\"
            
            Grading Rubric Item:
            - Criteria: {item.criteria}
            - Max Points Allowed: {item.max_points}
            
            Evaluate the student submission strictly against this specific criteria. 
            Award partial credit fairly based on the accuracy of their logic. 
            Do not award more than the maximum points allowed.
            """
            
            try:
                # Call Gemini with strict JSON enforcement matching our Pydantic model
                response = self.client.models.generate_content(
                    model='gemini-2.5-flash',
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        response_schema=CriterionEvaluation,
                        temperature=0.2 # Low temperature for consistent, objective grading
                    ),
                )
                
                # Parse the verified structured response
                result = CriterionEvaluation.model_validate_json(response.text)
                state["scores_pool"].append(result.score_awarded)
                state["justifications"].append(f"[{item.criteria}]: {result.rationale} (Score: {result.score_awarded}/{item.max_points})")
            
            except Exception as e:
                print(f"Error evaluating criterion '{item.criteria}': {e}")
                # Fallback safeguard if an API or validation error occurs
                state["scores_pool"].append(0.0)
                state["justifications"].append(f"[{item.criteria}]: Failed to evaluate due to system processing error.")
                
        return state

    def node_security_audit(self, state: AgentState) -> AgentState:
        """Node 2: Compiles final metrics, checks plagiarism, and constraints."""
        total_score = sum(state["scores_pool"])
        combined_rationale = " | ".join(state["justifications"])
        
        # Run Plagiarism Service Check
        is_plagiarized = False
        plagiarism_details = None
        
        try:
            is_plagiarized, plagiarism_details = PlagiarismService.check_plagiarism(
                exam_id=state["rubric"].exam_id,
                current_student=state["student_name"],
                current_text=state["student_answer"]
            )
        except Exception as e:
            print(f"Error running plagiarism check: {e}")
            
        if is_plagiarized and plagiarism_details:
            state["plagiarism_flag"] = True
            state["plagiarism_details"] = plagiarism_details
            combined_rationale = f"[PLAGIARISM WARNING]: {plagiarism_details} || " + combined_rationale
        else:
            state["plagiarism_flag"] = False
            state["plagiarism_details"] = None
            
        state["final_output"] = GradeResponse(
            proposed_score=total_score,
            justification=combined_rationale,
            plagiarism_flag=state["plagiarism_flag"]
        )
        return state

    async def run(self, student_answer: str, rubric: Rubric, student_name: str = "Student") -> GradeResponse:
        initial_state = {
            "student_answer": student_answer,
            "student_name": student_name,
            "rubric": rubric,
            "scores_pool": [],
            "justifications": [],
            "plagiarism_flag": False,
            "plagiarism_details": None,
            "final_output": None
        }
        
        # Execute the compiled graph asynchronously
        final_state = await self.app.ainvoke(initial_state)
        return final_state["final_output"]