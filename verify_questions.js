const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const API_URL = 'http://localhost:3001';
const DB_PATH = path.resolve(__dirname, 'backend/services/interview_bot.sqlite');

async function verifyQuestions() {
    console.log("1. Fetching active session...");
    // We assume the previous rounds verification left an active session.
    // Let's get the latest session.
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
                console.error("❌ No active round. Cannot generate questions.");
                return;
            }
            console.log(`   Active Round: ${activeRound.round_type} (ID: ${activeRound.round_id})`);

            // 2. Generate Questions
            console.log("2. Triggering Question Generation...");
            const genRes = await axios.post(`${API_URL}/api/interview/${interviewId}/round/${activeRound.round_id}/generate`);

            if (genRes.status === 200) {
                console.log("✅ API Success");
                const questions = genRes.data.questions;
                console.log(`   Generated ${questions.length} questions.`);

                if (questions.length > 0) {
                    console.log("   Sample Question:", questions[0].question_text);
                    console.log("   Type:", questions[0].question_type);
                } else {
                    console.error("❌ Warning: 0 Questions generated.");
                }

                // 3. Verify DB Persistence
                console.log("3. Verifying DB Persistence...");
                db.all("SELECT * FROM questions WHERE round_id = ?", [activeRound.round_id], (err, rows) => {
                    if (rows.length === questions.length) {
                        console.log(`✅ Verified: ${rows.length} questions found in DB.`);
                    } else {
                        console.error(`❌ DB Mismatch: Found ${rows.length}, expected ${questions.length}`);
                    }
                    db.close();
                });

            } else {
                console.error("❌ Generation Failed:", genRes.status);
                db.close();
            }

        } catch (error) {
            console.error("❌ Error:", error.message);
            if (error.response) console.error("   Data:", error.response.data);
            db.close();
        }
    });
}

verifyQuestions();
