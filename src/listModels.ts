import { GoogleGenerativeAI } from "@google/generative-ai";
import * as dotenv from 'dotenv';
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

async function list() {
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=\${process.env.GEMINI_API_KEY}`);
        const data = await response.json();
        console.log("可用模型列表：", JSON.stringify(data, null, 2));
    } catch (e) {
        console.error("無法取得列表", e);
    }
}

list();
