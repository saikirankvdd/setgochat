import fs from 'fs';

async function runTests() {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    let logs = "Starting Security Audit Tests...\n";
    function log(msg) { console.log(msg); logs += msg + '\n'; }

    // Test 1: Rate Limiter bypass or hit
    log("[1] Testing Rate Limits...");
    let successCount = 0;
    for (let i = 0; i < 15; i++) {
        try {
            const res = await fetch(`https://127.0.0.1:5000/api/request-register-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: `test${i}@example.com` })
            });
            if (res.status !== 429) successCount++;
            log(`req ${i}: ${res.status}`);
        } catch (e) {
            log(`err ${i}: ${e.message}`);
        }
    }
    log(`Rate limit test: ${successCount} requests succeeded out of 15.`);

    // Test 2: Large Payload (100MB body limit bypass)
    log("[2] Testing Large Payload DoS...");
    try {
        log("Creating 50MB payload in memory...");
        const largeString = 'A'.repeat(50 * 1024 * 1024); // 50MB
        const largePayload = { email: "foo@example.com", username: largeString };
        
        log("Sending 50MB payload... (This might crash the server)");
        const startTime = Date.now();
        const res = await fetch(`https://127.0.0.1:5000/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(largePayload)
        });
        const duration = Date.now() - startTime;
        log(`Large payload request finished in ${duration}ms with status: ${res.status}`);
        
        // Let's try 150MB payload to hit the limit
        log("Creating 150MB payload in memory...");
        const hugeString = 'B'.repeat(150 * 1024 * 1024); // 150MB
        const res2 = await fetch(`https://127.0.0.1:5000/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: "foo", username: hugeString })
        });
        log(`Huge 150MB payload request status: ${res2.status}`);

    } catch(e) {
         log("Error in Large Payload test (Did server crash?): " + e.message);
    }
    
    fs.writeFileSync('stress_clean.log', logs, 'utf8');
}

runTests().then(() => console.log("Tests complete.")).catch(console.error);
