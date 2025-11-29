// api/copilot.js
const WebSocket = require('ws');
const axios = require('axios');

class Copilot {
    constructor() {
        this.conversationId = null;
        this.models = {
            default: 'chat',
            'think-deeper': 'reasoning',
            'gpt-5': 'smart'
        };
        this.headers = {
            origin: 'https://copilot.microsoft.com',
            'user-agent': 'Mozilla/5.0 (Linux; Android 15; SM-F958 Build/AP3A.240905.015) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.86 Mobile Safari/537.36'
        };
    }
    
    async createConversation() {
        const { data } = await axios.post('https://copilot.microsoft.com/c/api/conversations', null, {
            headers: this.headers
        });
        
        this.conversationId = data.id;
        return this.conversationId;
    }
    
    async chat(message, { model = 'default' } = {}) {
        if (!this.conversationId) await this.createConversation();
        if (!this.models[model]) {
            throw new Error(`Available models: ${Object.keys(this.models).join(', ')}`);
        }
        
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(`wss://copilot.microsoft.com/c/api/chat?api-version=2&features=-,ncedge,edgepagecontext&setflight=-,ncedge,edgepagecontext&ncedge=1${this.accessToken ? `&accessToken=${this.accessToken}` : ''}`, {
                headers: this.headers
            });
            
            const response = { text: '', citations: [] };
            const timeout = setTimeout(() => {
                ws.close();
                reject(new Error('Request timeout'));
            }, 50000); // 50 second timeout (Vercel limit is 60s for Hobby plan)
            
            ws.on('open', () => {
                ws.send(JSON.stringify({
                    event: 'setOptions',
                    supportedFeatures: ['partial-generated-images'],
                    supportedCards: ['weather', 'local', 'image', 'sports', 'video', 'ads', 'safetyHelpline', 'quiz', 'finance', 'recipe'],
                    ads: {
                        supportedTypes: ['text', 'product', 'multimedia', 'tourActivity', 'propertyPromotion']
                    }
                }));
                ws.send(JSON.stringify({
                    event: 'send',
                    mode: this.models[model],
                    conversationId: this.conversationId,
                    content: [{ type: 'text', text: message }],
                    context: {}
                }));
            });
            
            ws.on('message', (chunk) => {
                try {
                    const parsed = JSON.parse(chunk.toString());
                    
                    switch (parsed.event) {
                        case 'appendText':
                            response.text += parsed.text || '';
                            break;
                            
                        case 'citation':
                            response.citations.push({
                                title: parsed.title,
                                icon: parsed.iconUrl,
                                url: parsed.url
                            });
                            break;
                            
                        case 'done':
                            clearTimeout(timeout);
                            resolve(response);
                            ws.close();
                            break;
                            
                        case 'error':
                            clearTimeout(timeout);
                            reject(new Error(parsed.message));
                            ws.close();
                            break;
                    }
                } catch (error) {
                    clearTimeout(timeout);
                    reject(error);
                }
            });
            
            ws.on('error', (error) => {
                clearTimeout(timeout);
                reject(error);
            });
        });
    }
}

// Vercel serverless function handler
module.exports = async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // Handle preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ 
            error: 'Method not allowed',
            message: 'Please use POST method' 
        });
    }
    
    try {
        const { message, model = 'default' } = req.body;
        
        // Validate input
        if (!message || typeof message !== 'string') {
            return res.status(400).json({ 
                error: 'Bad request',
                message: 'Please provide a "message" field in the request body' 
            });
        }
        
        // Create Copilot instance and get response
        const copilot = new Copilot();
        const response = await copilot.chat(message, { model });
        
        // Return success response
        return res.status(200).json({
            success: true,
            data: response
        });
        
    } catch (error) {
        console.error('Copilot API Error:', error);
        return res.status(500).json({ 
            error: 'Internal server error',
            message: error.message 
        });
    }
};
