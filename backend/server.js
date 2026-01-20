const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');

const { uploadToS3 } = require('./services/storage');
const {
    saveResumeMetadata,
    updateParsedData,
    updateSelectedRole,
    getResume,
    createInterviewSession,
    getInterviewWithRounds,
    updateRoundStatus,
    saveQuestion,
    getQuestions,
    saveAnswer,
    getAnswers,
    updateInterviewResult,
    getAllQuestions
} = require('./services/db');

const {
    parseResume,
    generateQuestions,
    evaluateAnswer,
    generateFeedbackSummary
} = require('./services/llm');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ✅ REQUIRED FIX: question cache (prevents duplicate questions)
const questionCache = {};

// Configure Multer for memory storage
const upload = multer({ storage: multer.memoryStorage() });

// Serve local storage (mock S3)
app.use('/local_storage', express.static('local_storage'));

/* ============================
   API: Upload Resume
============================ */
app.post('/api/upload-resume', upload.single('resume'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        console.log(`[Upload] Receiving file: ${req.file.originalname}`);

        // Upload to mock S3
        const s3Result = await uploadToS3(req.file);
        console.log(`[S3] Stored at: ${s3Result.Key}`);

        // Save metadata
        const userId = 'demo-user-123';
        const record = await saveResumeMetadata(userId, s3Result.Key);

        res.json({
            message: 'Resume uploaded successfully',
            resumeId: record.resumeId,
            url: s3Result.Location
        });

    } catch (error) {
        console.error('Upload Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

/* ============================
   API: Parse Resume
============================ */
app.post('/api/parse-resume/:resumeId', async (req, res) => {
    try {
        const { resumeId } = req.params;

        const resume = await getResume(resumeId);
        if (!resume) {
            return res.status(404).json({ error: 'Resume not found' });
        }

        const filePath = path.join(
            __dirname,
            'local_storage',
            'ai-interview-resumes',
            resume.s3_object_key
        );

        const extractedData = await parseResume(filePath);

        await updateParsedData(
            resumeId,
            extractedData.skills,
            extractedData.projects,
            extractedData.recommended_roles
        );

        res.json({
            message: 'Parsing successful',
            data: extractedData
        });

    } catch (error) {
        console.error('Parsing Error:', error);
        res.status(500).json({ error: 'Failed to parse resume' });
    }
});

/* ============================
   API: Select Role
============================ */
app.post('/api/select-role', async (req, res) => {
    try {
        const { resumeId, role } = req.body;

        if (!resumeId || !role) {
            return res.status(400).json({ error: 'Missing resumeId or role' });
        }

        await updateSelectedRole(resumeId, role);
        res.json({ message: 'Role saved successfully' });

    } catch (error) {
        console.error('Role Selection Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

/* ============================
   API: Start Interview
============================ */
app.post('/api/start-interview', async (req, res) => {
    try {
        const { resumeId, jobRole } = req.body;
        const userId = 'demo-user-123';

        if (!resumeId || !jobRole) {
            return res.status(400).json({ error: 'Missing resumeId or jobRole' });
        }

        const interviewId = await createInterviewSession(
            userId,
            resumeId,
            jobRole
        );

        res.json({
            message: 'Interview Session Created',
            interviewId,
            status: 'STARTED'
        });

    } catch (error) {
        console.error('Start Interview Error:', error);
        res.status(500).json({ error: 'Failed to start interview' });
    }
});

/* ============================
   API: Interview Status
============================ */
app.get('/api/interview/:interviewId/status', async (req, res) => {
    try {
        const { interviewId } = req.params;
        const session = await getInterviewWithRounds(interviewId);

        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        let currentActive = session.rounds.find(r => r.status === 'ACTIVE');

        if (currentActive) {
            // Check if all questions are answered
            const questions = await getQuestions(interviewId, currentActive.round_id);
            const answers = await getAnswers(interviewId);
            const roundAnswers = answers.filter(a => a.round_id === currentActive.round_id);

            const allQuestionsAnswered = questions.length > 0 && roundAnswers.length >= questions.length;

            // Check timer expiry (fallback condition)
            const startTime = new Date(currentActive.started_at).getTime();
            const now = Date.now();
            const durationMs = currentActive.duration_minutes * 60000;
            const timerExpired = now - startTime > durationMs;

            // Complete round if all questions answered OR timer expired
            if (allQuestionsAnswered || timerExpired) {
                console.log(`[Round Complete] Round ${currentActive.round_id}: ${allQuestionsAnswered ? 'All questions answered' : 'Timer expired'}`);
                await updateRoundStatus(currentActive.round_id, 'COMPLETED');
                currentActive.status = 'COMPLETED';
                currentActive = null;
            }
        }

        if (!currentActive) {
            const nextRound = session.rounds.find(r => r.status === 'PENDING');
            if (nextRound) {
                await updateRoundStatus(nextRound.round_id, 'ACTIVE');
                nextRound.status = 'ACTIVE';
                nextRound.started_at = new Date().toISOString();
                currentActive = nextRound;
            } else if (session.status !== 'COMPLETED') {
                const answers = await getAnswers(interviewId);
                let total = 0, count = 0;
                const roundScores = {};

                for (const r of session.rounds) {
                    const rAnswers = answers.filter(a => a.round_id === r.round_id);
                    if (rAnswers.length) {
                        const avg = rAnswers.reduce((s, a) => s + a.score, 0) / rAnswers.length;
                        roundScores[r.round_type] = avg.toFixed(1);
                        total += avg;
                        count++;
                    }
                }

                const finalScore = count ? (total / count).toFixed(1) : 0;
                const feedback = await generateFeedbackSummary(
                    session.job_role,
                    roundScores,
                    finalScore
                );

                await updateInterviewResult(interviewId, finalScore, feedback);
                session.status = 'COMPLETED';
                session.total_score = finalScore;
                session.feedback = feedback;
            }
        }

        res.json({
            interviewId: session.interview_id,
            status: session.status,
            activeRound: currentActive,
            rounds: session.rounds,
            total_score: session.total_score,
            feedback: session.feedback
        });

    } catch (error) {
        console.error('Status Error:', error);
        res.status(500).json({ error: 'Failed to get status' });
    }
});

/* ============================
   API: Generate Questions
============================ */
app.post('/api/interview/:interviewId/round/:roundId/generate', async (req, res) => {
    try {
        const { interviewId, roundId } = req.params;

        const existing = await getQuestions(interviewId, roundId);
        if (existing.length) {
            return res.json({ questions: existing });
        }

        const session = await getInterviewWithRounds(interviewId);
        const resume = await getResume(session.resume_id);
        const round = session.rounds.find(r => r.round_id === roundId);

        // Fetch ALL previous questions to prevent repetition across the ENTIRE interview
        const allQuestions = await getAllQuestions(interviewId);
        const previousQuestions = allQuestions.map(q => q.question_text);
        const previousSet = new Set(previousQuestions);

        const context = `Skills: ${resume.parsed_skills}. Projects: ${resume.parsed_projects}`;
        const rawQuestions = await generateQuestions(
            context,
            session.job_role,
            round.round_type,
            previousQuestions
        );

        // HARD DEDUP: Enforce uniqueness by question_text across interview,
        // even if the LLM (or mock) returns duplicates or ignores history.
        const questions = [];
        for (const q of rawQuestions || []) {
            if (!q || !q.text) continue;
            if (previousSet.has(q.text)) {
                console.warn(`[AI] Skipping duplicate question text: "${q.text}"`);
                continue;
            }
            previousSet.add(q.text);
            questions.push(q);
        }

        for (const q of questions) {
            await saveQuestion(
                interviewId,
                roundId,
                q.text,
                q.question_type,
                q.options,
                q.correct
            );
        }

        res.json({ questions });

    } catch (error) {
        console.error('Generate Error:', error);
        res.status(500).json({ error: 'Failed to generate questions' });
    }
});

/* ============================
   API: Fetch Questions
============================ */
app.get('/api/interview/:interviewId/round/:roundId/questions', async (req, res) => {
    try {
        const { interviewId, roundId } = req.params;
        const cacheKey = `${interviewId}_${roundId}`;

        if (questionCache[cacheKey]) {
            return res.json({ questions: questionCache[cacheKey] });
        }

        const questions = await getQuestions(interviewId, roundId);
        questionCache[cacheKey] = questions;

        // SANITIZE: Remove correct answer before sending to frontend
        const sanitized = questions.map(q => {
            const { correct_answer, ...rest } = q;
            return rest;
        });

        res.json({ questions: sanitized });

    } catch (error) {
        console.error('Fetch Questions Error:', error);
        res.status(500).json({ error: 'Failed to fetch questions' });
    }
});

/* ============================
   API: Get Answers for Round
============================ */
app.get('/api/interview/:interviewId/round/:roundId/answers', async (req, res) => {
    try {
        const { interviewId, roundId } = req.params;
        const answers = await getAnswers(interviewId);

        // Filter answers for this specific round
        const roundAnswers = answers.filter(a => a.round_id === roundId);

        res.json({ answers: roundAnswers });

    } catch (error) {
        console.error('Fetch Answers Error:', error);
        res.status(500).json({ error: 'Failed to fetch answers' });
    }
});

/* ============================
   API: Get All Answers for Interview
============================ */
app.get('/api/interview/:interviewId/answers', async (req, res) => {
    try {
        const { interviewId } = req.params;
        const answers = await getAnswers(interviewId);
        res.json({ answers });
    } catch (error) {
        console.error('Fetch All Answers Error:', error);
        res.status(500).json({ error: 'Failed to fetch answers' });
    }
});

/* ============================
   API: Submit Answer
============================ */
app.post('/api/interview/:interviewId/submit', async (req, res) => {
    try {
        const { interviewId } = req.params;
        const { roundId, questionId, answer, questionText, type, options, correct } = req.body;

        let score = 0;
        let feedback = '';

        if (type === 'MCQ') {
            score = answer === correct ? 10 : 0;
            feedback = answer === correct ? 'Correct' : `Correct was: ${correct}`;
        } else {
            const evalResult = await evaluateAnswer(questionText, answer, type);
            score = evalResult.score;
            feedback = evalResult.feedback;
        }

        await saveAnswer(interviewId, roundId, questionId, answer, score, feedback);

        // Check if this was the last question in the round
        const questions = await getQuestions(interviewId, roundId);
        const answers = await getAnswers(interviewId);
        const roundAnswers = answers.filter(a => a.round_id === roundId);

        // If all questions answered, mark round as complete immediately
        if (questions.length > 0 && roundAnswers.length >= questions.length) {
            console.log(`[Round Complete] Round ${roundId}: All questions answered`);
            await updateRoundStatus(roundId, 'COMPLETED');
        }

        res.json({ score, feedback });


    } catch (error) {
        console.error('Submit Error:', error);
        res.status(500).json({ error: 'Failed to submit answer' });
    }
});

app.listen(PORT, () => {
    console.log(`API Server running on http://localhost:${PORT}`);
});
