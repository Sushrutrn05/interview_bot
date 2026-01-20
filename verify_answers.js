const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const API_URL = 'http://localhost:3001';
const DB_PATH = path.resolve(__dirname, 'backend/services/interview_bot.sqlite');

async function verifyAnswers() {
    console.log("1. Fetching active session and questions...");
    const db = new sqlite3.Database(DB_PATH);

    db.get("SELECT interview_id FROM interviews ORDER BY started_at DESC LIMIT 1", async (err, row) => {
        if (err || !row) {
            console.error("❌ No interview found.");
            db.close();
            return;
        }
        const interviewId = row.interview_id;
        console.log(`   Using Interview ID: ${interviewId}`);

        try {
            // 1. Get Status to find Active Round
            const statusRes = await axios.get(`${API_URL}/api/interview/${interviewId}/status`);
            const activeRound = statusRes.data.activeRound;

            if (!activeRound) {
                console.error("❌ No active round.");
                return;
            }

            // 2. Fetch Questions (Generated in previous step)
            console.log(`   Fetching questions for Round: ${activeRound.round_type}`);
            const qRes = await axios.get(`${API_URL}/api/interview/${interviewId}/round/${activeRound.round_id}/questions`);
            const questions = qRes.data.questions;

            if (questions.length === 0) {
                console.error("❌ No questions found. Run verify_questions.js first.");
                return;
            }

            const targetQ = questions[0];
            console.log("   Submitting answer for:", targetQ.question_text);

            // 3. Submit Answer
            const answerPayload = {
                roundId: activeRound.round_id,
                questionId: targetQ.question_id,
                answer: "This is a test answer for verification.",
                questionText: targetQ.question_text,
                type: targetQ.question_type,
                options: targetQ.options,
                correct: targetQ.correct_answer
            };

            const subRes = await axios.post(`${API_URL}/api/interview/${interviewId}/submit`, answerPayload);

            if (subRes.status === 200) {
                console.log("✅ Submission Success");
                console.log("   Score received:", subRes.data.score);
                console.log("   Feedback:", subRes.data.feedback);

                // 4. Verify DB
                console.log("4. Verifying DB Persistence...");
                db.get("SELECT * FROM answers WHERE question_id = ?", [targetQ.question_id], (err, row) => {
                    if (row) {
                        console.log("✅ Verified: Answer found in DB.");
                        console.log("   Stored Answer:", row.user_answer);
                    } else {
                        console.error("❌ DB Check Failed: Answer not found.");
                    }
                    db.close();
                });
            } else {
                console.error("❌ Submission Failed:", subRes.status);
                db.close();
            }

        } catch (error) {
            console.error("❌ Error:", error.message);
            if (error.response) console.error("   Data:", error.response.data);
            db.close();
        }
    });
}

verifyAnswers();
