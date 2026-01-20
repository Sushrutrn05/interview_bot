const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const API_URL = 'http://localhost:3001';
const DB_PATH = path.resolve(__dirname, 'backend/services/interview_bot.sqlite');

async function verifyRounds() {
    console.log("1. Fetching last interview ID from DB...");
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
            console.log("2. Fetching Session Status (Should trigger Auto-Start)...");
            const res = await axios.get(`${API_URL}/api/interview/${interviewId}/status`);

            if (res.status === 200) {
                console.log("✅ API Status Success");
                const data = res.data;
                console.log("   Active Round:", data.activeRound?.round_type);
                console.log("   Status:", data.activeRound?.status);

                // Check if we have 3 rounds
                console.log(`   Total Rounds: ${data.rounds.length}`);
                if (data.rounds.length === 3) console.log("✅ Verified: 3 Rounds created.");
                else console.error("❌ Verification Failed: Rounds count mismatch.");

                // Check Timer
                if (data.activeRound?.duration_minutes > 0) {
                    console.log(`✅ Verified: Duration set to ${data.activeRound.duration_minutes} mins.`);
                } else {
                    console.error("❌ Verification Failed: No duration.");
                }

            } else {
                console.error("❌ API Failed:", res.status);
            }

        } catch (error) {
            console.error("❌ Error fetching status:", error.message);
        } finally {
            db.close();
        }
    });
}

verifyRounds();
