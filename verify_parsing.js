const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

const API_URL = 'http://localhost:3001';
const DUMMY_PDF_PATH = path.resolve(__dirname, 'dummy_resume_parse.pdf');

async function testParsing() {
    console.log("1. Creating dummy PDF for parsing...");
    // Create a dummy PDF with some text that the mock LLM might pick up
    // Note: The mock LLM in services/llm.js checks for keywords like "Java", "Docker" in the text content.
    // However, pdf-parse might not extract text from a plain text file pretending to be PDF easily unless it has valid PDF structure.
    // But verify_upload.js reused the same "dummy content" and it worked for *upload*.
    // For *parsing*, pdf-parse will likely fail or return empty text if it's not a real PDF.
    // The mock LLM logic: if text contains "java", add "Java".

    // Let's rely on the Mock LLM's default return if parsing fails or returns empty, 
    // OR essentially the PDF parser might throw if invalid.
    // For robust testing, we should try to upload a file that pdf-parse won't choke on, 
    // OR just handle the potential empty text.
    // The mock LLM implementation:
    // const data = await pdf(dataBuffer); ...

    // If we write just "Dummy Content", pdf-parse might throw. 
    // Let's write a minimal PDF structure if possible, or just rely on the fact that 
    // the previous test passed upload.
    // Actually, let's just create a file. If pdf-parse fails, we'll know.

    fs.writeFileSync(DUMMY_PDF_PATH, "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 3 3]/Parent 2 0 R/Resources<<>>/Contents 4 0 R>>endobj 4 0 obj<</Length 15>>stream\nHello Java World\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f \n0000000010 00000 n \n0000000060 00000 n \n0000000111 00000 n \n0000000212 00000 n \ntrailer<</Size 5/Root 1 0 R>>\nstartxref\n278\n%%EOF");

    const formData = new FormData();
    formData.append('resume', fs.createReadStream(DUMMY_PDF_PATH));

    try {
        // 1. Upload
        console.log("2. Uploading file...");
        const uploadRes = await axios.post(`${API_URL}/api/upload-resume`, formData, {
            headers: { ...formData.getHeaders() }
        });

        if (uploadRes.status !== 200) throw new Error("Upload failed");
        const resumeId = uploadRes.data.resumeId;
        console.log(`   Resume ID: ${resumeId}`);

        // 2. Parse
        console.log("3. Triggering Parsing...");
        const parseRes = await axios.post(`${API_URL}/api/parse-resume/${resumeId}`);

        if (parseRes.status === 200) {
            console.log("✅ Parsing API Success:", parseRes.data);
            const { data } = parseRes.data;

            console.log("   Extracted Skills:", data.skills);
            console.log("   Extracted Projects:", data.projects);

            if (data.skills && data.skills.length > 0) {
                console.log("✅ Verified: Skills extracted.");
            } else {
                console.error("❌ Verification Failed: No skills extracted.");
            }
        } else {
            console.error("❌ Parsing Failed Status:", parseRes.status);
        }

    } catch (error) {
        console.error("❌ Parsing Test Error:", error.message);
        if (error.response) {
            console.error("   Response Data:", error.response.data);
        }
    } finally {
        if (fs.existsSync(DUMMY_PDF_PATH)) fs.unlinkSync(DUMMY_PDF_PATH);
    }
}

testParsing();
