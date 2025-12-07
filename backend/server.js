import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";

import { exec } from "child_process";
import os from "os";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
// Serve static frontend files
app.use(express.static(path.join(__dirname, "../Frontend")));

// Configure Multer (Memory Storage)
const upload = multer({ storage: multer.memoryStorage() });

// Test route
app.get("/ping", (req, res) => {
  console.log("GET /ping");
  res.json({ ok: true });
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Store chat session in memory (for single-user local demo)
let chatSession = null;

app.post("/chat", upload.single("file"), async (req, res) => {
  try {
    console.log("--- POST /chat ---");
    console.log("File:", req.file ? `Yes (${req.file.mimetype}, ${req.file.size} bytes)` : "No");
    console.log("Text:", req.body.text);

    const userText = req.body.text || "";
    const file = req.file;

    // Tool Definitions
    const tools = [
      {
        functionDeclarations: [
          {
            name: "getCurrentTime",
            description: "Get the current time.",
          },
          {
            name: "getWeather",
            description: "Get the current weather for a specific location.",
            parameters: {
              type: "OBJECT",
              properties: {
                location: {
                  type: "STRING",
                  description: "The city and state, e.g. San Francisco, CA",
                },
              },
              required: ["location"],
            },
          },
          {
            name: "openWebsite",
            description: "Open a website or search for something in the browser.",
            parameters: {
              type: "OBJECT",
              properties: {
                url: {
                  type: "STRING",
                  description: "The full URL to open (must start with http:// or https://). If searching, construct a google search URL.",
                },
              },
              required: ["url"],
            },
          },
          {
            name: "openApp",
            description: "Open a desktop application on the user's computer (Mac).",
            parameters: {
              type: "OBJECT",
              properties: {
                appName: {
                  type: "STRING",
                  description: "The name of the application to open (e.g., 'Calculator', 'Notes', 'Visual Studio Code').",
                },
              },
              required: ["appName"],
            },
          },
          {
            name: "getSystemInfo",
            description: "Get information about the user's computer system (OS, memory, CPU).",
          },
        ],
      },
    ];

    // Tool Implementations
    const functions = {
      getCurrentTime: () => {
        return { time: new Date().toLocaleString() };
      },
      getWeather: async ({ location }) => {
        try {
          console.log(`Fetching weather for: ${location}`);
          const response = await fetch(`https://wttr.in/${encodeURIComponent(location)}?format=j1`);
          const data = await response.json();
          const current = data.current_condition[0];
          return {
            temperature_C: current.temp_C,
            condition: current.weatherDesc[0].value,
            humidity: current.humidity,
          };
        } catch (e) {
          console.error("Weather Fetch Error:", e);
          return { error: "Unable to fetch weather info." };
        }
      },
      openWebsite: ({ url }) => {
        console.log(`Action: Opening ${url}`);
        // Return a special object that we can detect in the loop
        return {
          status: "success",
          message: "Website opened on client device.",
          _clientAction: { type: "OPEN_URL", url }
        };
      },
      openApp: async ({ appName }) => {
        console.log(`Action: Opening App ${appName}`);
        return new Promise((resolve) => {
          exec(`open -a "${appName}"`, (error) => {
            if (error) {
              console.error(`Error opening app: ${error.message}`);
              resolve({ status: "error", message: `Could not open ${appName}. It might not be installed.` });
            } else {
              resolve({ status: "success", message: `Opened ${appName} successfully.` });
            }
          });
        });
      },
      getSystemInfo: () => {
        return {
          osType: os.type(),
          osRelease: os.release(),
          totalMemory: `${(os.totalmem() / 1024 / 1024 / 1024).toFixed(2)} GB`,
          freeMemory: `${(os.freemem() / 1024 / 1024 / 1024).toFixed(2)} GB`,
          cpuModel: os.cpus()[0].model,
          cpuCores: os.cpus().length,
        };
      }
    };

    // Initialize chat if needed
    // We do NOT reset if a file is uploaded anymore, to allow multi-turn conversation about the image.
    if (!chatSession) {
      const model = genAI.getGenerativeModel({
        model: "gemini-flash-lite-latest",
        systemInstruction: "You are Nova, a smart, concise, and helpful AI voice assistant. You have access to tools to check time, weather, open websites, open desktop apps, and check system info. Use them when asked. Use Markdown formatting (bold, italics, lists) to make your responses easy to read. Keep your answers conversational and concise. Always reply in the same language and dialect as the user (e.g., Indian English).",
        tools: tools,
      });

      chatSession = model.startChat({
        history: [],
      });
    }

    // Construct Parts
    const parts = [];

    if (file) {
      parts.push({
        inlineData: {
          data: file.buffer.toString("base64"),
          mimeType: file.mimetype,
        },
      });
    }

    if (userText) {
      parts.push({ text: userText });
    }

    // Send message and handle function calls
    let result = await chatSession.sendMessage(parts);
    let response = result.response;
    let functionCalls = response.functionCalls();

    let clientAction = null;

    while (functionCalls) {
      const functionResponses = [];

      for (const call of functionCalls) {
        const fn = functions[call.name];
        if (fn) {
          const fnResult = await fn(call.args);

          // Check for client-side action trigger
          if (fnResult._clientAction) {
            clientAction = fnResult._clientAction;
          }

          functionResponses.push({
            functionResponse: {
              name: call.name,
              response: fnResult,
            },
          });
        }
      }

      if (functionResponses.length > 0) {
        result = await chatSession.sendMessage(functionResponses);
        response = result.response;
        functionCalls = response.functionCalls();
      } else {
        break;
      }
    }

    const reply = response.text();

    if (!reply) return res.json({ reply: null });

    res.json({ reply, action: clientAction });

  } catch (err) {
    console.error("Gemini Error:", err);
    chatSession = null; // Reset on error to be safe
    res.json({ reply: `I encountered an error: ${err.message}` });
  }
});

// IMPORTANT FOR MAC
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend running on http://127.0.0.1:${PORT}`);
});