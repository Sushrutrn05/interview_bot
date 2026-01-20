const axios = require('axios');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const API_URL = 'http://localhost:3001';
const DB_PATH = path.resolve(__dirname, 'backend/services/interview_bot.sqlite');

async function testSessionCreation() {
    console.log("1. Starting Verification for Session Creation...");

    // We need a valid resumeId first. 
    // Let's assume the previous parsing verification created one, or we can look it up in the DB.
    // Ideally, we create a fresh one to be self-contained, but to save time let's query the DB for the last resume.

    const db = new sqlite3.Database(DB_PATH);

    db.get("SELECT resume_id, parsed_roles FROM resumes ORDER BY uploaded_at DESC LIMIT 1", async (err, row) => {
        if (err) {
            console.error("❌ DB Error:", err);
            return;
        }
        if (!row) {
            console.error("❌ No resumes found. Please run verify_parsing.js first.");
            return;
        }

        const resumeId = row.resume_id;
        let jobRole = "Generic Developer";
        try {
            const roles = JSON.parse(row.parsed_roles);
            if (roles && roles.length > 0) jobRole = roles[0];
        } catch (e) { }

        console.log(`   Using Resume ID: ${resumeId}`);
        console.log(`   Target Role: ${jobRole}`);

        try {
            // Call Start Interview API
            console.log("2. Calling /api/start-interview...");
            const res = await axios.post(`${API_URL}/api/start-interview`, {
                resumeId: resumeId,
                jobRole: jobRole
            });

            if (res.status === 200) {
                console.log("✅ API Success:", res.data);
                const interviewId = res.data.interviewId;

                // Verify DB insertion
                console.log("3. Verifying DB Insertion...");
                db.get("SELECT * FROM interviews WHERE interview_id = ?", [interviewId], (err, row) => {
                    if (row) {
                        console.log("✅ Interview Session Found in DB:", row);
                        console.log("   Status:", row.status);
                        console.log("   Role:", row.job_role);
                    } else {
                        console.error("❌ Interview not found in DB.");
                    }
                    db.close();
                });
            } else {
                console.error("❌ API Failed:", res.status);
                db.close();
            }

        } catch (apiErr) {
            console.error("❌ API Request Error:", apiErr.message);
            if (apiErr.response) console.error("   Data:", apiErr.response.data);
            db.close();
        }
    });
}

testSessionCreation();
