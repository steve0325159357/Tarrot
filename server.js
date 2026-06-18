// server.js (部署在 Render 的後端程式碼)

const express = require('express');
const cors = require('cors');

// 如果使用 node-fetch (Node 18 以下需要安裝並引入，Node 18 以上內建)
// const fetch = require('node-fetch'); 

const app = express();
const port = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// ==========================================
// 1. 解決問題一：Cron-job 保活用的 Health Check 路由
// ==========================================
// 當 cron-job 訪問根目錄時，回傳 200 OK
app.get('/', (req, res) => {
    res.status(200).send('Tarot Backend is awake and healthy!');
});

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', message: 'Server is running.' });
});

// ==========================================
// 2. 解決問題二：多重 API Key 切換與重試機制
// ==========================================
// 從環境變數讀取 API Keys (請在 Render 的 Environment Variables 設定 GEMINI_API_KEYS="key1,key2,key3")
// 如果沒有設定 GEMINI_API_KEYS，則退回尋找單一的 GEMINI_API_KEY
const rawKeys = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "";
const apiKeys = rawKeys.split(',').map(k => k.trim()).filter(k => k.length > 0);

let currentKeyIndex = 0;

// 輔助函數：延遲 (Delay)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function callGeminiWithRetryAndRotation(payload, retryCount = 0) {
    if (apiKeys.length === 0) {
        throw new Error("伺服器未設定任何 Gemini API Key！");
    }

    // 設定最大重試次數 (例如：金鑰數量的 2 倍)
    const maxRetries = apiKeys.length * 2; 

    if (retryCount >= maxRetries) {
        throw new Error(`已嘗試 ${retryCount} 次皆失敗。目前 Google AI 伺服器可能過載或所有 Key 皆耗盡。`);
    }

    const currentKey = apiKeys[currentKeyIndex];
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${currentKey}`;

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        // 成功取得回應
        if (response.ok) {
            return await response.json();
        }

        // 解析錯誤內容
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error?.message || `Status: ${response.status}`;

        console.warn(`[嘗試 ${retryCount + 1}/${maxRetries}] Key [${currentKeyIndex}] 請求失敗 - ${response.status} ${errorMessage}`);

        // 如果是 503 (High Demand) 或 429 (Too Many Requests)，則切換 Key 並重試
        if (response.status === 503 || response.status === 429 || response.status >= 500) {
             console.log(`觸發切換機制：從 Key [${currentKeyIndex}] 切換至下一個...`);
             currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
             
             // 遇到 503 稍微等一下再試 (例如等 2 秒)
             await delay(2000); 
             return callGeminiWithRetryAndRotation(payload, retryCount + 1);
        } else {
             // 如果是 400 (Bad Request) 這類程式邏輯錯誤，不用重試，直接拋出
             throw new Error(`API 請求錯誤: ${errorMessage}`);
        }

    } catch (error) {
        // 捕捉 fetch 網路層級的錯誤 (例如 DNS 解析失敗)
        console.error(`[網路錯誤] 嘗試 ${retryCount + 1}/${maxRetries} 失敗:`, error.message);
        
        currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
        await delay(2000);
        return callGeminiWithRetryAndRotation(payload, retryCount + 1);
    }
}

// ==========================================
// 3. 處理占卜請求的 API 端點
// ==========================================
app.post('/api/tarot-reading', async (req, res) => {
    try {
        const { userPrompt, systemPrompt } = req.body;

        // 確保前端有傳遞必要的資料
        if (!userPrompt || !systemPrompt) {
             return res.status(400).json({ error: "缺少必要的提示詞 (userPrompt 或 systemPrompt)" });
        }

        const payload = {
            system_instruction: {
                parts: [{ text: systemPrompt }]
            },
            contents: [{
                parts: [{ text: userPrompt }]
            }],
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 3000,
            }
        };

        // 呼叫帶有自動切換與重試機制的函數
        const data = await callGeminiWithRetryAndRotation(payload);
        
        // 確保有回傳結果
        if (data && data.candidates && data.candidates.length > 0) {
            const resultText = data.candidates[0].content.parts[0].text;
            res.json({ result: resultText });
        } else {
            throw new Error("Google API 回傳的資料格式異常或為空。");
        }

    } catch (error) {
        console.error("處理占卜請求時發生錯誤:", error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(port, () => {
    console.log(`Tarot Backend Server is running on port ${port}`);
    console.log(`已載入 ${apiKeys.length} 把 API Keys 準備輪詢。`);
});
