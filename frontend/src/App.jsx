import React, { useState, useEffect, useRef } from 'react';

const API_BASE = 'http://localhost:8000';

export default function App() {
  const [role, setRole] = useState('TA'); // 'Instructor' or 'TA'
  const [exams, setExams] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  
  // Instructor Rubric Form
  const [examId, setExamId] = useState('');
  const [examName, setExamName] = useState('');
  const [rubricItems, setRubricItems] = useState([
    { criteria: 'Correct logic and mathematical formulation', max_points: 5.0 },
    { criteria: 'Proper execution details & edge case handling', max_points: 5.0 }
  ]);
  
  // Instructor Upload Form
  const [uploadExamId, setUploadExamId] = useState('');
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  
  // TA Grading Dashboard State
  const [taExamId, setTaExamId] = useState('');
  const [taStatus, setTaStatus] = useState('pending');
  const [currentIndex, setCurrentIndex] = useState(0);
  
  // TA Override Fields
  const [overrideScore, setOverrideScore] = useState('');
  const [overrideJustification, setOverrideJustification] = useState('');
  const [isSavingGrade, setIsSavingGrade] = useState(false);
  const [isFlagging, setIsFlagging] = useState(false);
  
  // Fetch initial data
  useEffect(() => {
    fetchExams();
    fetchSubmissions();
  }, []);

  const fetchExams = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/exams`);
      const data = await res.json();
      setExams(data);
      if (data.length > 0) {
        setUploadExamId(data[0].id);
        setTaExamId(data[0].id);
      }
    } catch (err) {
      console.error("Failed to fetch exams:", err);
    }
  };

  const fetchSubmissions = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/submissions`);
      const data = await res.json();
      setSubmissions(data);
    } catch (err) {
      console.error("Failed to fetch submissions:", err);
    }
  };

  // Filtered submissions queue for TA
  const activeQueue = submissions.filter(sub => {
    const matchExam = !taExamId || sub.exam_id === taExamId;
    const matchStatus = !taStatus || sub.status === taStatus;
    return matchExam && matchStatus;
  });

  const currentSubmission = activeQueue[currentIndex] || null;

  // Sync override fields when current submission changes
  useEffect(() => {
    if (currentSubmission) {
      setOverrideScore(currentSubmission.proposed_score);
      setOverrideJustification(currentSubmission.justification);
    } else {
      setOverrideScore('');
      setOverrideJustification('');
    }
  }, [currentSubmission, currentIndex]);

  // Handle Rubric Builder Actions
  const addRubricRow = () => {
    setRubricItems([...rubricItems, { criteria: '', max_points: 5.0 }]);
  };

  const removeRubricRow = (index) => {
    const updated = rubricItems.filter((_, i) => i !== index);
    setRubricItems(updated);
  };

  const updateRubricItem = (index, field, value) => {
    const updated = [...rubricItems];
    if (field === 'max_points') {
      updated[index][field] = parseFloat(value) || 0.0;
    } else {
      updated[index][field] = value;
    }
    setRubricItems(updated);
  };

  const saveExamAndRubric = async (e) => {
    e.preventDefault();
    if (!examId.trim() || !examName.trim()) {
      return alert("Please enter both Exam ID and Exam Name.");
    }
    if (rubricItems.some(item => !item.criteria.trim())) {
      return alert("Please fill in criteria text for all rubric items.");
    }
    
    try {
      const res = await fetch(`${API_BASE}/api/exams`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: examId,
          name: examName,
          rubric_items: rubricItems
        })
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.message);
        fetchExams();
        setExamId('');
        setExamName('');
      } else {
        alert("Error saving exam: " + data.detail);
      }
    } catch (err) {
      console.error("Error creating exam:", err);
      alert("Failed to save exam.");
    }
  };

  // Handle Bulk Upload
  const handleFileChange = (e) => {
    setSelectedFiles(Array.from(e.target.files));
  };

  const uploadBulkSubmissions = async (e) => {
    e.preventDefault();
    if (!uploadExamId) return alert("Select an exam ID first!");
    if (selectedFiles.length === 0) return alert("Please select files (PDF/Images) to upload.");
    
    setIsUploading(true);
    const formData = new FormData();
    formData.append("exam_id", uploadExamId);
    selectedFiles.forEach(file => {
      formData.append("files", file);
    });

    try {
      const res = await fetch(`${API_BASE}/api/upload-bulk`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.message);
        setSelectedFiles([]);
        fetchSubmissions();
      } else {
        alert("Upload error: " + data.detail);
      }
    } catch (err) {
      console.error("Error uploading:", err);
      alert("Bulk upload failed.");
    } finally {
      setIsUploading(false);
    }
  };

  // Grade Approvals and Overrides
  const submitFinalGrade = async (statusOverride = 'approved') => {
    if (!currentSubmission) return;
    
    setIsSavingGrade(true);
    try {
      const res = await fetch(`${API_BASE}/api/submissions/${currentSubmission.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          score: parseFloat(overrideScore),
          justification: overrideJustification
        })
      });
      if (res.ok) {
        // Refresh local items
        fetchSubmissions();
        // Go to next item if index fits
        if (currentIndex < activeQueue.length - 1) {
          setCurrentIndex(currentIndex + 1);
        } else if (currentIndex > 0) {
          setCurrentIndex(currentIndex - 1);
        }
      } else {
        const errorData = await res.json();
        alert("Failed to save grade: " + errorData.detail);
      }
    } catch (err) {
      console.error("Grade submit failed:", err);
    } finally {
      setIsSavingGrade(false);
    }
  };

  const flagForReview = async () => {
    if (!currentSubmission) return;
    
    setIsFlagging(true);
    try {
      const res = await fetch(`${API_BASE}/api/submissions/${currentSubmission.id}/flag`, {
        method: 'POST'
      });
      if (res.ok) {
        fetchSubmissions();
        if (currentIndex < activeQueue.length - 1) {
          setCurrentIndex(currentIndex + 1);
        } else if (currentIndex > 0) {
          setCurrentIndex(currentIndex - 1);
        }
      } else {
        alert("Failed to flag submission.");
      }
    } catch (err) {
      console.error("Flag failed:", err);
    } finally {
      setIsFlagging(false);
    }
  };

  // Keyboard Navigation & Shortcuts handler
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Avoid firing shortcuts when typing in inputs/textareas
      if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') {
        return;
      }
      
      if (role !== 'TA' || !currentSubmission) return;

      if (e.key === 'Enter') {
        e.preventDefault();
        submitFinalGrade();
      } else if (e.key === ' ') {
        e.preventDefault();
        flagForReview();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (currentIndex > 0) setCurrentIndex(currentIndex - 1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (currentIndex < activeQueue.length - 1) setCurrentIndex(currentIndex + 1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [role, currentSubmission, currentIndex, activeQueue, overrideScore, overrideJustification]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      
      {/* Header bar */}
      <header className="glass-panel" style={{ 
        margin: '15px 20px', 
        padding: '12px 25px', 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        borderRadius: '12px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ 
            width: '36px', 
            height: '36px', 
            borderRadius: '8px', 
            background: 'linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 'bold',
            fontSize: '1.2rem',
            boxShadow: '0 0 15px rgba(99,102,241,0.4)'
          }}>G</div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 700, background: 'linear-gradient(to right, #ffffff, var(--text-muted))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            GRADEOPS <span style={{ fontSize: '0.8rem', color: 'var(--primary)', letterSpacing: '0.1em', fontWeight: 600, textTransform: 'uppercase' }}>Human-in-the-loop</span>
          </h2>
        </div>
        
        {/* Toggle Switch */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 500 }}>Switch Role:</span>
          <div style={{ 
            background: 'rgba(255,255,255,0.04)', 
            padding: '4px', 
            borderRadius: '10px', 
            border: '1px solid var(--border-color)',
            display: 'flex',
            gap: '2px'
          }}>
            <button 
              onClick={() => setRole('Instructor')}
              style={{
                background: role === 'Instructor' ? 'var(--primary)' : 'transparent',
                color: '#fff',
                fontSize: '0.8rem',
                padding: '6px 14px',
                borderRadius: '6px',
                boxShadow: role === 'Instructor' ? '0 4px 12px rgba(99,102,241,0.35)' : 'none'
              }}
            >
              Instructor
            </button>
            <button 
              onClick={() => setRole('TA')}
              style={{
                background: role === 'TA' ? 'var(--primary)' : 'transparent',
                color: '#fff',
                fontSize: '0.8rem',
                padding: '6px 14px',
                borderRadius: '6px',
                boxShadow: role === 'TA' ? '0 4px 12px rgba(99,102,241,0.35)' : 'none'
              }}
            >
              Teaching Assistant (TA)
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main style={{ flex: 1, padding: '0 20px 20px', display: 'flex', flexDirection: 'column' }}>
        
        {role === 'Instructor' ? (
          /* INSTRUCTOR PORTAL */
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '20px' }}>
            
            {/* Left side: Rubric Creator & Bulk Upload */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              
              {/* Rubric Builder */}
              <div className="glass-panel animate-fade-in" style={{ padding: '25px' }}>
                <h3 style={{ fontSize: '1.2rem', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-main)' }}>
                  <span style={{ color: 'var(--primary)' }}>#</span> Define Grading Rubrics
                </h3>
                <form onSubmit={saveExamAndRubric}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '15px', marginBottom: '20px' }}>
                    <div>
                      <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>Exam ID / Code</label>
                      <input 
                        type="text" 
                        placeholder="e.g. CS101-MID" 
                        value={examId} 
                        onChange={(e) => setExamId(e.target.value.toUpperCase())}
                        style={{ width: '100%' }}
                        required
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>Exam Name</label>
                      <input 
                        type="text" 
                        placeholder="e.g. Introduction to Computer Science Midterm" 
                        value={examName} 
                        onChange={(e) => setExamName(e.target.value)}
                        style={{ width: '100%' }}
                        required
                      />
                    </div>
                  </div>

                  <div style={{ marginBottom: '20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)' }}>Granular Evaluation Rubric Items</span>
                      <button 
                        type="button" 
                        onClick={addRubricRow}
                        style={{ background: 'rgba(99,102,241,0.1)', color: 'var(--primary)', padding: '5px 12px', fontSize: '0.75rem' }}
                      >
                        + Add Criterion
                      </button>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {rubricItems.map((item, idx) => (
                        <div key={idx} style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                          <input 
                            type="text" 
                            placeholder="Evaluation Criteria Details" 
                            value={item.criteria} 
                            onChange={(e) => updateRubricItem(idx, 'criteria', e.target.value)}
                            style={{ flex: 1 }}
                            required
                          />
                          <input 
                            type="number" 
                            step="0.5" 
                            placeholder="Max pts" 
                            value={item.max_points} 
                            onChange={(e) => updateRubricItem(idx, 'max_points', e.target.value)}
                            style={{ width: '90px' }}
                            required
                          />
                          <button 
                            type="button" 
                            onClick={() => removeRubricRow(idx)}
                            style={{ background: 'var(--danger-glow)', color: 'var(--danger)', padding: '10px', width: '40px', display: 'flex', justifyContent: 'center' }}
                            disabled={rubricItems.length <= 1}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <button 
                    type="submit" 
                    className="glow-primary"
                    style={{ background: 'var(--primary)', color: 'white', width: '100%', padding: '12px' }}
                  >
                    Save Exam & Rubric Template
                  </button>
                </form>
              </div>

              {/* Bulk Upload Portal */}
              <div className="glass-panel animate-fade-in" style={{ padding: '25px' }}>
                <h3 style={{ fontSize: '1.2rem', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ color: 'var(--secondary)' }}>#</span> Bulk Exam Scan Upload
                </h3>
                <form onSubmit={uploadBulkSubmissions}>
                  <div style={{ marginBottom: '20px' }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>Select Exam Subject</label>
                    <select 
                      value={uploadExamId} 
                      onChange={(e) => setUploadExamId(e.target.value)}
                      style={{ width: '100%' }}
                      required
                    >
                      {exams.length === 0 ? (
                        <option value="">-- No Exams Created Yet --</option>
                      ) : (
                        exams.map(ex => <option key={ex.id} value={ex.id}>{ex.name} ({ex.id})</option>)
                      )}
                    </select>
                  </div>

                  <div style={{ 
                    border: '2px dashed var(--border-color)', 
                    borderRadius: '12px', 
                    padding: '30px', 
                    textAlign: 'center',
                    background: 'rgba(255,255,255,0.01)',
                    marginBottom: '20px',
                    transition: 'border-color 0.2s',
                    cursor: 'pointer'
                  }}>
                    <input 
                      type="file" 
                      multiple 
                      accept="image/*,application/pdf"
                      onChange={handleFileChange}
                      style={{ display: 'none' }}
                      id="bulk-file-input"
                    />
                    <label htmlFor="bulk-file-input" style={{ cursor: 'pointer' }}>
                      <span style={{ fontSize: '2rem', display: 'block', marginBottom: '8px' }}>📂</span>
                      <span style={{ fontSize: '0.9rem', color: 'var(--text-main)', display: 'block', fontWeight: 600 }}>Click to choose exam sheets</span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>PDF documents or JPEG/PNG sheets</span>
                    </label>
                    
                    {selectedFiles.length > 0 && (
                      <div style={{ marginTop: '15px', background: 'rgba(255,255,255,0.03)', padding: '10px', borderRadius: '8px', textAlign: 'left' }}>
                        <span style={{ fontSize: '0.8rem', color: 'var(--primary)', fontWeight: 600 }}>Selected files:</span>
                        <ul style={{ listStyle: 'none', margin: '5px 0 0 0', padding: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          {selectedFiles.map((f, i) => <li key={i}>📄 {f.name} ({Math.round(f.size/1024)} KB)</li>)}
                        </ul>
                      </div>
                    )}
                  </div>

                  <button 
                    type="submit" 
                    disabled={isUploading || exams.length === 0}
                    style={{ 
                      background: 'linear-gradient(to right, var(--primary), var(--secondary))', 
                      color: 'white', 
                      width: '100%', 
                      padding: '12px',
                      opacity: (isUploading || exams.length === 0) ? 0.6 : 1
                    }}
                  >
                    {isUploading ? "Uploading & running Agent Pipeline OCR/Grading..." : "Submit Sheets to AI Pipeline"}
                  </button>
                </form>
              </div>

            </div>

            {/* Right side: Plagiarism & Status Overview */}
            <div className="glass-panel animate-fade-in" style={{ padding: '25px', display: 'flex', flexDirection: 'column' }}>
              <h3 style={{ fontSize: '1.2rem', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ color: 'var(--success)' }}>#</span> Plagiarism & Submission Audit Log
              </h3>
              
              <div style={{ flex: 1, overflowY: 'auto', maxHeight: '680px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {submissions.length === 0 ? (
                  <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '50px 0' }}>
                    No submissions uploaded yet. Go ahead and submit some papers!
                  </div>
                ) : (
                  submissions.map(sub => {
                    const isPlag = sub.plagiarism_flag === 1;
                    return (
                      <div 
                        key={sub.id} 
                        style={{ 
                          padding: '15px', 
                          borderRadius: '10px', 
                          border: '1px solid var(--border-color)', 
                          background: isPlag ? 'rgba(244, 63, 94, 0.04)' : 'rgba(255,255,255,0.01)',
                          borderColor: isPlag ? 'rgba(244, 63, 94, 0.25)' : 'var(--border-color)'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                          <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{sub.student_name}</span>
                          <span className={`badge badge-${sub.status}`}>{sub.status}</span>
                        </div>
                        
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '8px' }}>
                          <span>Exam: <strong>{sub.exam_id}</strong></span> | 
                          <span style={{ marginLeft: '8px' }}>AI Recommended: <strong>{sub.proposed_score} pts</strong></span>
                        </div>

                        {isPlag && (
                          <div style={{ 
                            background: 'var(--danger-glow)', 
                            border: '1px solid rgba(244, 63, 94, 0.2)', 
                            borderRadius: '6px', 
                            padding: '6px 10px', 
                            fontSize: '0.75rem', 
                            color: 'var(--danger)',
                            fontWeight: 600
                          }}>
                            ⚠️ Plagiarism Warning: {sub.justification.split('||')[0]}
                          </div>
                        )}
                        
                        {!isPlag && (
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-dark)', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                            {sub.justification}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

          </div>
        ) : (
          /* TA EVALUATION DASHBOARD */
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '15px' }}>
            
            {/* Filter controls */}
            <div className="glass-panel" style={{ padding: '15px 20px', display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Exam:</span>
                <select value={taExamId} onChange={(e) => { setTaExamId(e.target.value); setCurrentIndex(0); }}>
                  <option value="">-- All Exams --</option>
                  {exams.map(ex => <option key={ex.id} value={ex.id}>{ex.name}</option>)}
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Queue:</span>
                <select value={taStatus} onChange={(e) => { setTaStatus(e.target.value); setCurrentIndex(0); }}>
                  <option value="pending">Pending Review</option>
                  <option value="approved">Approved</option>
                  <option value="flagged">Flagged for Review</option>
                  <option value="">All Submissions</option>
                </select>
              </div>

              <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', gap: '10px', alignItems: 'center' }}>
                {activeQueue.length > 0 && (
                  <>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      Paper <strong>{currentIndex + 1}</strong> of <strong>{activeQueue.length}</strong>
                    </span>
                    <div style={{ display: 'flex', gap: '5px' }}>
                      <button 
                        onClick={() => setCurrentIndex(c => Math.max(0, c - 1))}
                        disabled={currentIndex === 0}
                        style={{ padding: '6px 12px', fontSize: '0.8rem', background: 'rgba(255,255,255,0.05)', cursor: currentIndex === 0 ? 'not-allowed' : 'pointer' }}
                      >
                        ◀ Prev
                      </button>
                      <button 
                        onClick={() => setCurrentIndex(c => Math.min(activeQueue.length - 1, c + 1))}
                        disabled={currentIndex === activeQueue.length - 1}
                        style={{ padding: '6px 12px', fontSize: '0.8rem', background: 'rgba(255,255,255,0.05)', cursor: currentIndex === activeQueue.length - 1 ? 'not-allowed' : 'pointer' }}
                      >
                        Next ▶
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Split viewport panels */}
            {currentSubmission ? (
              <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: '20px', minHeight: '60vh' }}>
                
                {/* Left viewport: Document image/pdf viewer */}
                <div className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>Student Answer Sheet</h3>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-dark)' }}>{currentSubmission.student_name}</span>
                  </div>
                  
                  <div style={{ 
                    flex: 1, 
                    background: '#040710', 
                    borderRadius: '10px', 
                    overflow: 'hidden', 
                    border: '1px solid var(--border-color)',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    position: 'relative'
                  }}>
                    {currentSubmission.file_path.toLowerCase().endsWith('.pdf') ? (
                      <iframe
                        src={`${API_BASE}${currentSubmission.file_path}`}
                        style={{ width: '100%', height: '100%', border: 'none' }}
                        title="PDF Viewer"
                      />
                    ) : (
                      <img 
                        src={`${API_BASE}${currentSubmission.file_path}`} 
                        alt="Answer sheet scan" 
                        style={{ 
                          maxWidth: '100%', 
                          maxHeight: '100%', 
                          objectFit: 'contain',
                          boxShadow: '0 4px 20px rgba(0,0,0,0.5)'
                        }}
                      />
                    )}
                  </div>
                </div>

                {/* Right viewport: AI grade recommendation & overrides */}
                <div className="glass-panel" style={{ padding: '25px', display: 'flex', flexDirection: 'column', gap: '20px', overflowY: 'auto' }}>
                  
                  {/* Student metadata */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <h2 style={{ fontSize: '1.3rem' }}>{currentSubmission.student_name}</h2>
                      <span className={`badge badge-${currentSubmission.status}`}>{currentSubmission.status}</span>
                    </div>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      Exam Subject: <strong>{currentSubmission.exam_id}</strong>
                    </p>
                  </div>

                  <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)' }} />

                  {/* Plagiarism warning if flagged */}
                  {currentSubmission.plagiarism_flag === 1 && (
                    <div style={{ 
                      background: 'var(--danger-glow)', 
                      border: '1px solid rgba(244, 63, 94, 0.2)', 
                      borderRadius: '8px', 
                      padding: '12px 15px', 
                      color: 'var(--danger)',
                      fontSize: '0.85rem'
                    }}>
                      <h4 style={{ marginBottom: '4px', fontWeight: 700 }}>⚠️ Plagiarism Similarity Flagged</h4>
                      <p>{currentSubmission.justification.split('||')[0]}</p>
                    </div>
                  )}

                  {/* AI Extracted OCR Text */}
                  <div style={{ background: 'rgba(255,255,255,0.015)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '15px' }}>
                    <h4 style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '8px', fontWeight: 600 }}>Extracted OCR Answer</h4>
                    <p style={{ fontSize: '0.85rem', lineHeight: '1.5', color: 'var(--text-main)', whiteSpace: 'pre-wrap' }}>
                      {currentSubmission.extracted_text}
                    </p>
                  </div>

                  {/* Grading panel */}
                  <div>
                    <h4 style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '10px', fontWeight: 600 }}>Score Allocation</h4>
                    <div style={{ display: 'flex', gap: '20px', alignItems: 'center', marginBottom: '15px' }}>
                      <div>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-dark)', display: 'block' }}>AI Proposed</span>
                        <span style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--primary)' }}>
                          {currentSubmission.proposed_score}
                        </span>
                      </div>
                      <div style={{ fontSize: '1.5rem', color: 'var(--text-dark)' }}>→</div>
                      <div>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-dark)', display: 'block' }}>TA Overrides</span>
                        <input 
                          type="number" 
                          step="0.5"
                          value={overrideScore} 
                          onChange={(e) => setOverrideScore(e.target.value)}
                          style={{ width: '80px', fontSize: '1.2rem', fontWeight: 700, textAlign: 'center', padding: '6px' }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Grading Justifications & Rationale */}
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <h4 style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>Grading Rationale & Rubric Breakdown</h4>
                    <textarea 
                      value={overrideJustification} 
                      onChange={(e) => setOverrideJustification(e.target.value)}
                      style={{ width: '100%', flex: 1, minHeight: '120px', resize: 'vertical', fontSize: '0.85rem', lineHeight: '1.5' }}
                    />
                  </div>

                  {/* Action buttons */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginTop: '10px' }}>
                    <button 
                      onClick={() => submitFinalGrade()}
                      disabled={isSavingGrade}
                      style={{ 
                        background: 'var(--success)', 
                        color: 'white', 
                        padding: '12px',
                        boxShadow: '0 4px 15px rgba(16,185,129,0.2)' 
                      }}
                    >
                      {isSavingGrade ? "Submitting..." : "Approve Grade (Enter)"}
                    </button>
                    <button 
                      onClick={flagForReview}
                      disabled={isFlagging}
                      style={{ 
                        background: 'var(--danger-glow)', 
                        color: 'var(--danger)', 
                        border: '1px solid rgba(244,63,94,0.2)',
                        padding: '12px' 
                      }}
                    >
                      {isFlagging ? "Flagging..." : "Flag for Review (Space)"}
                    </button>
                  </div>
                  
                  <div style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-dark)' }}>
                    💡 Tip: Use keyboard shortcuts (<strong>Enter</strong> to approve, <strong>Space</strong> to flag, <strong>← / →</strong> to browse)
                  </div>

                </div>

              </div>
            ) : (
              <div className="glass-panel" style={{ padding: '80px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                <h3>No submissions matching the filter criteria found in the queue.</h3>
                <p style={{ marginTop: '10px', fontSize: '0.9rem' }}>Create exams/rubrics and upload exam sheets in the Instructor view to populate this queue.</p>
              </div>
            )}

          </div>
        )}

      </main>
    </div>
  );
}