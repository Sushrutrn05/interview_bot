const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const API_URL = 'http://localhost:3001';
const DB_PATH = path.resolve(__dirname, 'backend/services/interview_bot.sqlite');

async function verifyCompletion() {
    console.log("1. Fetching active session...");
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
            // Force Complete all Rounds
            console.log("2. Simulating Completion of All Rounds...");

            // Get all rounds
            const rounds = await new Promise((resolve) => {
                db.all("SELECT * FROM interview_rounds WHERE interview_id = ?", [interviewId], (err, rows) => resolve(rows));
            });

            const timestamp = new Date().toISOString();

            for (const r of rounds) {
                if (r.status !== 'COMPLETED') {
                    console.log(`   Marking Round ${r.round_type} as COMPLETED...`);
                    await new Promise((resolve) => {
                        db.run("UPDATE interview_rounds SET status = 'COMPLETED', completed_at = ? WHERE round_id = ?", [timestamp, r.round_id], resolve);
                    });
                }
            }

            // 3. Trigger Status Check (Which should finalize status)
            console.log("3. Triggering Finalization via Status API...");
            const res = await axios.get(`${API_URL}/api/interview/${interviewId}/status`);

            if (res.data.status === 'COMPLETED') {
                console.log("✅ Interview Finalized Successfully");
                console.log("   Final Score:", res.data.total_score);
                console.log("   Feedback:", res.data.feedback);

                // 4. Verify DB
                db.get("SELECT * FROM interviews WHERE interview_id = ?", [interviewId], (err, row) => {
                    if (row.status === 'COMPLETED' && row.total_score !== null) {
                        console.log("✅ Verified: DB Updated correctly.");
                    } else {
                        console.error("❌ DB Mismatch: Status or Score missing.");
                        console.log(row);
                    }
                    db.close();
                });
            } else {
                console.error("❌ Finalization Failed. Status:", res.data.status);
                db.close();
            }

        } catch (error) {
            console.error("❌ Error:", error.message);
            db.close();
        }
    });
}

verifyCompletion();
