const axios = require('axios');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const FormData = require('form-data');

const API_URL = 'http://localhost:3001';
const DB_PATH = path.resolve(__dirname, 'backend/services/interview_bot.sqlite');
const DUMMY_PDF_PATH = path.resolve(__dirname, 'dummy_resume.pdf');

async function testUpload() {
    console.log("1. Creating dummy PDF...");
    fs.writeFileSync(DUMMY_PDF_PATH, "Dummy PDF Content %PDF-1.4");

    const formData = new FormData();
    formData.append('resume', fs.createReadStream(DUMMY_PDF_PATH));

    try {
        console.log("2. Uploading to API...");
        const response = await axios.post(`${API_URL}/api/upload-resume`, formData, {
            headers: {
                ...formData.getHeaders()
            }
        });

        if (response.status === 200) {
            console.log("✅ Upload API Success:", response.data);
            const { resumeId, url } = response.data;

            // Verify File Storage
            const storedPath = path.resolve(__dirname, 'backend/local_storage/ai-interview-resumes', path.basename(url));
            // The URL from backend is /local_storage/..., we need to map it to file system
            // URL: /local_storage/ai-interview-resumes/<uuid>-dummy_resume.pdf
            // FileSystem: backend/local_storage/ai-interview-resumes/<uuid>-dummy_resume.pdf

            // Let's strip the leading /local_storage from the URL to find the file relative to backend/local_storage
            const relativePath = url.replace('/local_storage/', '');
            const fullPath = path.resolve(__dirname, 'backend/local_storage', relativePath);

            console.log(`3. Verifying File Existence at ${fullPath}...`);
            if (fs.existsSync(fullPath)) {
                console.log("✅ File stored successfully.");
            } else {
                console.error("❌ File NOT found locally.");
            }

            // Verify DB
            console.log("4. Verifying Database Entry...");
            const db = new sqlite3.Database(DB_PATH);
            db.get("SELECT * FROM resumes WHERE resume_id = ?", [resumeId], (err, row) => {
                if (err) {
                    console.error("❌ DB Query Error:", err);
                } else if (row) {
                    console.log("✅ Database Entry Found:");
                    console.log(row);
                } else {
                    console.error("❌ Resume not found in DB.");
                }
                db.close();
            });

        } else {
            console.error("❌ Upload Failed Status:", response.status);
        }

    } catch (error) {
        console.error("❌ Upload Error:", error.message);
        if (error.code === 'ECONNREFUSED') {
            console.error("   (Is the backend server running on port 3001?)");
        }
    } finally {
        // Cleanup
        if (fs.existsSync(DUMMY_PDF_PATH)) fs.unlinkSync(DUMMY_PDF_PATH);
    }
}

testUpload();
