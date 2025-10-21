// server/utils/openaiClient.js
const winston = require("winston");

// Logger for OpenAI operations
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  transports: [
    new winston.transports.File({ filename: "logs/openai-error.log", level: "error" }),
    new winston.transports.File({ filename: "logs/openai.log" }),
  ],
});

if (process.env.NODE_ENV !== "production") {
  logger.add(
    new winston.transports.Console({
      format: winston.format.simple(),
    }),
  );
}

// ✅ Dynamic OpenAI client initialization for v4.104.0
let openaiClient = null;

const getOpenAIClient = async () => {
  if (!openaiClient) {
    try {
      // ✅ Dynamic import for ES module compatibility
      const { default: OpenAI } = await import('openai');
      
      openaiClient = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        baseURL: "https://openrouter.ai/api/v1",
        defaultHeaders: {
          "HTTP-Referer": process.env.APP_URL || "http://localhost:5000",
          "X-Title": "Synaptron Backend",
        }
      });
      
      logger.info("OpenAI client initialized successfully");
    } catch (error) {
      logger.error("Failed to initialize OpenAI client:", error.message);
      throw error;
    }
  }
  return openaiClient;
};

/**
 * Enhanced JSON parser (same as your existing)
 */
const cleanAndParseJSON = (responseText) => {
  try {
    let cleanedText = responseText.trim();
   cleanedText = cleanedText.replace(/```json\s*/gi, ''); // Remove ```
cleanedText = cleanedText.replace(/```\s*/gi, '');     // Remove ```
cleanedText = cleanedText.replace(/^Here are.*?:\s*/i, ''); // Remove intro text

    
    const jsonStart = cleanedText.indexOf('{');
    const jsonEnd = cleanedText.lastIndexOf('}');
    
    if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
      cleanedText = cleanedText.substring(jsonStart, jsonEnd + 1);
    }
    
    let parsed = JSON.parse(cleanedText);
    
    function fixStringifiedArrays(obj) {
      if (typeof obj !== 'object' || obj === null) return obj;
      
      if (Array.isArray(obj)) {
        return obj.map(fixStringifiedArrays);
      }
      
      const result = {};
      for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'string' && (value.startsWith('[') && value.endsWith(']'))) {
          try {
            let fixedValue = value.replace(/'/g, '"');
            fixedValue = fixedValue.replace(/([\{,]\s*)([a-zA-Z0-9_]+)(\s*):/g, '$1"$2"$3:');
            const parsedArray = JSON.parse(fixedValue);
            result[key] = fixStringifiedArrays(parsedArray);
          } catch (parseError) {
            logger.warn(`Failed to parse stringified array for key ${key}:`, parseError.message);
            result[key] = [];
          }
        } else if (typeof value === 'object') {
          result[key] = fixStringifiedArrays(value);
        } else {
          result[key] = value;
        }
      }
      return result;
    }
    
    return fixStringifiedArrays(parsed);
    
  } catch (error) {
    logger.error("JSON parsing failed", { 
      error: error.message,
      responseText: responseText.substring(0, 200) + '...'
    });
    throw new Error(`Failed to parse AI response as JSON: ${error.message}`);
  }
};

/**
 * ✅ Send chat completion using OpenAI v4.104.0
 */
const sendChatCompletion = async (messages, options = {}) => {
  const startTime = Date.now();

  try {
    const {
      model = process.env.OPENROUTER_MODEL || "meta-llama/llama-3.1-405b-instruct:free",
      maxTokens = 1000,
      temperature = 0.7,
      presencePenalty = 0.1,
      frequencyPenalty = 0.1,
      stream = false,
      requireJSON = false,
      ...otherOptions
    } = options;

    logger.info("Sending chat completion request", {
      model,
      messageCount: messages.length,
      maxTokens,
      temperature,
      requireJSON
    });

    // Add JSON instruction if required
    if (requireJSON) {
      if (messages[0]?.role === 'system') {
        messages[0].content += '\n\nIMPORTANT: You must respond with valid JSON only. No markdown, no explanations outside the JSON object.';
      } else {
        messages.unshift({
          role: 'system',
          content: 'You must respond with valid JSON only. No markdown, no explanations outside the JSON object.'
        });
      }
    }

    // ✅ Get OpenAI client dynamically
    const openai = await getOpenAIClient();

    const completionOptions = {
      model,
      messages,
      max_tokens: maxTokens,
      temperature,
      presence_penalty: presencePenalty,
      frequency_penalty: frequencyPenalty,
      stream,
      ...otherOptions,
    };

    // Force JSON response format if required and supported
    if (requireJSON && (model.includes('gpt-4') || model.includes('gpt-3.5-turbo'))) {
      completionOptions.response_format = { type: "json_object" };
    }

    // ✅ v4.104.0 API call
    const completion = await openai.chat.completions.create(completionOptions);

    const processingTime = Date.now() - startTime;
    const responseContent = completion.choices[0]?.message?.content;

    logger.info("Chat completion successful", {
      model,
      processingTime,
      tokensUsed: completion.usage?.total_tokens || 0,
      finishReason: completion.choices[0]?.finish_reason,
    });

    // Parse JSON if required
    let parsedContent = responseContent;
    if (requireJSON && responseContent) {
      try {
        parsedContent = cleanAndParseJSON(responseContent);
      } catch (parseError) {
        logger.warn("JSON parsing failed, attempting fallback", { error: parseError.message });
        parsedContent = responseContent;
      }
    }

    return {
      success: true,
      data: completion,
      content: parsedContent,
      rawContent: responseContent,
      processingTime,
      tokensUsed: completion.usage?.total_tokens || 0,
    };

  } catch (error) {
    const processingTime = Date.now() - startTime;

    logger.error("Chat completion failed", {
      error: error.message,
      code: error.code,
      type: error.type,
      processingTime,
      model: options.model || "default",
    });

    // Handle specific OpenAI/OpenRouter errors
    if (error.code === "insufficient_quota") {
      throw new Error("API quota exceeded. Please check your billing.");
    } else if (error.code === "invalid_api_key") {
      throw new Error("Invalid API key.");
    } else if (error.code === "model_not_found") {
      throw new Error(`Model ${options.model || "default"} not found.`);
    } else if (error.code === "context_length_exceeded") {
      throw new Error("Message too long for the model's context window.");
    }

    throw error;
  }
};

/**
 * ✅ Send chat completion with retry logic
 */
const sendChatCompletionWithRetry = async (messages, options = {}, maxRetries = 3) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await sendChatCompletion(messages, options);
    } catch (error) {
      if ((error.message.includes('429') || 
           error.message.includes('Rate limit') || 
           error.message.includes('quota')) && 
          attempt < maxRetries) {
        
        const delay = Math.min(1000 * Math.pow(2, attempt), 15000);
        logger.warn(`Rate limited, retrying in ${delay}ms... (attempt ${attempt}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
};

// All your other functions remain the same...
const generateCodeAnalysisPrompt = (code, language, framework = "", description = "") => {
  const systemPrompt = `You are an expert code reviewer and software architect with deep knowledge in ${language}${
    framework ? ` and ${framework}` : ""
  }.

IMPORTANT: You MUST respond with valid JSON only. Do not include any markdown formatting, explanations, or text outside the JSON object.

Analyze the provided code and return a comprehensive analysis in the following JSON format:

{
  "summary": "Brief overview of the code",
  "quality_score": 85,
  "issues": [
    {
      "type": "bug|security|performance|style|complexity",
      "severity": "low|medium|high|critical",
      "line": 10,
      "message": "Description of the issue",
      "suggestion": "How to fix it",
      "fixable": true
    }
  ],
  "suggestions": [
    {
      "category": "refactoring|optimization|security|best-practices",
      "priority": "low|medium|high|critical",
      "title": "Suggestion title",
      "description": "Detailed description",
      "impact": "Expected impact"
    }
  ],
  "metrics": {
    "complexity": 8,
    "maintainability": 75,
    "security_score": 90
  }
}

Focus on:
- Code quality and maintainability
- Security vulnerabilities
- Performance optimizations
- Best practices for ${language}
- Potential bugs and edge cases`;

  const userPrompt = `${description ? `Description: ${description}\n\n` : ""}${
    framework ? `Framework: ${framework}\n\n` : ""
  }Code to analyze:

\`\`\`${language}
${code}
\`\`\``;

  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];
};

const generateChatPrompt = (chatHistory, domain = "general", mode = "chat") => {
  const systemPrompts = {
    chat: `You are Synaptron, an AI assistant specialized in ${domain}. You are helpful, knowledgeable, and provide clear explanations. Keep responses conversational but informative.`,
    code: `You are Synaptron, a coding expert in ${domain}. Help with programming questions, provide code examples, explain concepts, and debug issues. Format code properly with syntax highlighting.`,
    debug: `You are Synaptron, a debugging specialist in ${domain}. Help identify and fix bugs, explain error messages, and provide step-by-step debugging guidance.`,
    help: `You are Synaptron, a helpful assistant in ${domain}. Provide guidance, explanations, and step-by-step instructions. Be patient and thorough in your explanations.`,
  };

  const systemMessage = {
    role: "system",
    content: systemPrompts[mode] || systemPrompts.chat,
  };

  return [systemMessage, ...chatHistory];
};

/**
 * ✅ Validate API key using dynamic import
 */
const validateApiKey = async () => {
  try {
    await sendChatCompletion([
      { role: "user", content: "Hello" }
    ], {
      model: process.env.OPENROUTER_MODEL || "meta-llama/llama-3.1-8b-instruct:free",
      maxTokens: 5
    });
    
    logger.info("API key validation successful");
    return true;
  } catch (error) {
    logger.error("API key validation failed", { error: error.message });
    return false;
  }
};

const getAvailableModels = async () => {
  try {
    const openai = await getOpenAIClient();
    const response = await openai.models.list();
    const models = response.data
      .filter((model) => model.id.includes("gpt") || model.id.includes("llama"))
      .map((model) => ({
        id: model.id,
        created: model.created,
        owned_by: model.owned_by,
      }));

    logger.info("Retrieved available models", { count: models.length });
    return models;
  } catch (error) {
    logger.error("Failed to retrieve models", { error: error.message });
    
    // Fallback to common OpenRouter models
    const fallbackModels = [
      { id: "meta-llama/llama-3.1-405b-instruct:free", name: "Llama 3.1 405B (Free)" },
      { id: "meta-llama/llama-3.1-8b-instruct:free", name: "Llama 3.1 8B (Free)" },
      { id: "openai/gpt-4o-mini", name: "GPT-4 Omni Mini" },
      { id: "openai/gpt-4o", name: "GPT-4 Omni" },
      { id: "anthropic/claude-3-sonnet", name: "Claude 3 Sonnet" }
    ];
    
    return fallbackModels;
  }
};

const estimateTokenCount = (text) => {
  return Math.ceil(text.length / 4);
};

const truncateMessages = (messages, maxTokens = 3000) => {
  let totalTokens = 0;
  const truncatedMessages = [];

  if (messages[0]?.role === "system") {
    truncatedMessages.push(messages[0]);
    totalTokens += estimateTokenCount(messages[0].content);
  }

  for (let i = messages.length - 1; i >= 1; i--) {
    const messageTokens = estimateTokenCount(messages[i].content);
    if (totalTokens + messageTokens <= maxTokens) {
      truncatedMessages.unshift(messages[i]);
      totalTokens += messageTokens;
    } else {
      break;
    }
  }

  logger.info("Messages truncated", {
    original: messages.length,
    truncated: truncatedMessages.length,
    estimatedTokens: totalTokens,
  });

  return truncatedMessages;
};

const healthCheck = async () => {
  try {
    const isValid = await validateApiKey();
    return {
      status: isValid ? 'healthy' : 'unhealthy',
      apiKey: isValid ? 'valid' : 'invalid',
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
};

// ✅ CommonJS exports with lazy-loaded openai client
module.exports = {
  getOpenAI: getOpenAIClient, // Export the client getter
  sendChatCompletion,
  sendChatCompletionWithRetry,
  generateCodeAnalysisPrompt,
  generateChatPrompt,
  validateApiKey,
  getAvailableModels,
  estimateTokenCount,
  truncateMessages,
  cleanAndParseJSON,
  healthCheck,
  logger,
};
