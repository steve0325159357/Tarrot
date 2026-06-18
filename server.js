require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3005;

// 允許跨域請求 (如果是前後端分離部署，這很重要)
app.use(cors());
// 解析 JSON 格式的請求本體
app.use(express.json());

// 讓伺服器提供 public 資料夾裡的 index.html 靜態網頁
app.use(express.static('public'));

// ==========================================
// 處理塔羅占卜的 API 路由
// ==========================================
app.post('/api/tarot-reading', async (req, res) => {
    try {
        const { userPrompt, systemPrompt } = req.body;
        
        // 從 .env 中安全地讀取 API Key
        const apiKey = process.env.GOOGLE_API_KEY; 

        if (!apiKey) {
            return res.status(500).json({ error: "伺服器未設定 GOOGLE_API_KEY 環境變數" });
        }

        // 【修正點】：將模型名稱改為 gemini-1.5-flash-latest (加上 -latest 後綴)
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
        
        const googlePayload = { 
            contents: [{ parts: [{ text: userPrompt }] }], 
            systemInstruction: { parts: [{ text: systemPrompt }] },
            generationConfig: { maxOutputTokens: 2500, temperature: 0.7 }
        };

        const googleRes = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(googlePayload)
        });

        const data = await googleRes.json();

        // 處理 Google 拋出的錯誤
        if (data.error) {
            console.error("Google API 錯誤:", data.error);
            return res.status(500).json({ error: data.error.message });
        }

        // 提取文字並回傳給前端
        const textResult = data.candidates[0].content.parts[0].text;
        res.json({ result: textResult });

    } catch (error) {
        console.error("後端處理錯誤:", error);
        res.status(500).json({ error: "伺服器處理請求時發生錯誤" });
    }
});

// 啟動伺服器
app.listen(PORT, () => {
    console.log(`✨ 星語神諭後端伺服器已啟動: http://localhost:${PORT}`);
});