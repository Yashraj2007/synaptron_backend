const { validationResult } = require("express-validator")
const OpenAI = require("openai")
const ChatMessage = require("../models/ChatMessage")
const User = require("../models/User")
const mongoose = require("mongoose") // Import mongoose
const { sendChatCompletion, generateChatPrompt, truncateMessages } = require("../utils/openaiClient")
const { logChat } = require("../utils/logger")
const { formatChatMessage, formatSuccessResponse } = require("../utils/formatters")

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: "https://openrouter.ai/api/v1", // Add this line
})


// @desc    Send message to AI and get response
// @route   POST /api/chat/send
// @access  Private
const sendMessage = async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: "❌ Validation failed",
        errors: errors.array(),
      })
    }

    const { message, sessionId, domain, mode = "chat", attachments = [] } = req.body
    const userId = req.user._id

    // Generate session ID if not provided
    const chatSessionId = sessionId || `session_${userId}_${Date.now()}`

    // Save user message
    const userMessage = new ChatMessage({
      userId,
      sessionId: chatSessionId,
      role: "user",
      message,
      metadata: {
        domain,
        mode,
        attachments,
      },
    })

    await userMessage.save()

    // Get recent chat history for context
    const recentMessages = await ChatMessage.find({
      userId,
      sessionId: chatSessionId,
      isDeleted: false,
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .select("role message")

    // Replace the existing OpenAI code with:
    const messages = generateChatPrompt(
      recentMessages.reverse().map((msg) => ({
        role: msg.role === "ai" ? "assistant" : msg.role,
        content: msg.message,
      })),
      domain,
      mode,
    )

    const truncatedMessages = truncateMessages(messages, 3000)

    const aiResult = await sendChatCompletion(truncatedMessages, {
      model: "gpt-3.5-turbo",
      maxTokens: 1000,
      temperature: 0.7,
    })

    const aiResponse = aiResult.data.choices[0].message.content
    const processingTime = aiResult.processingTime

    // Log chat activity
    logChat("send", userId, chatSessionId, {
      domain,
      mode,
      tokensUsed: aiResult.tokensUsed,
      processingTime,
    })

    // Save AI response
    const aiMessage = new ChatMessage({
      userId,
      sessionId: chatSessionId,
      role: "ai",
      message: aiResponse,
      metadata: {
        domain,
        mode,
        aiModel: "gpt-3.5-turbo",
        tokens: {
          prompt: aiResult.data.usage.prompt_tokens,
          completion: aiResult.data.usage.completion_tokens,
          total: aiResult.data.usage.total_tokens,
        },
        responseTime: processingTime,
        confidence: 0.85,
      },
    })

    await aiMessage.save()

    // Update user stats
    await User.findByIdAndUpdate(userId, {
      $inc: { "stats.totalChats": 1 },
    })

    // Emit real-time message via Socket.IO
    const io = req.app.get("io")
    if (io) {
      io.to(`user-${userId}`).emit("new-ai-message", {
        message: aiMessage,
        sessionId: chatSessionId,
      })
    }

    res.status(200).json({
      success: true,
      message: "✅ Message sent successfully",
      data: {
        userMessage,
        aiMessage,
        sessionId: chatSessionId,
        processingTime,
        tokensUsed: aiResult.data.usage.total_tokens,
      },
    })
  } catch (error) {
    console.error("🚨 Send Message Error:", error)

    // Handle OpenAI specific errors
    if (error.code === "insufficient_quota") {
      return res.status(429).json({
        success: false,
        message: "🤖 AI service quota exceeded. Please try again later.",
      })
    }

    res.status(500).json({
      success: false,
      message: "🔥 Failed to send message",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    })
  }
}

// @desc    Get chat history for user
// @route   GET /api/chat/history/:userId
// @access  Private
const getChatHistory = async (req, res) => {
  try {
    const { userId } = req.params
    const { sessionId, limit = 50, page = 1, domain, role, startDate, endDate } = req.query

    // Check if user can access this chat history
    if (userId !== req.user._id.toString() && req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "🔒 Access denied. You can only view your own chat history.",
      })
    }

    const options = {
      sessionId,
      limit: Number.parseInt(limit),
      page: Number.parseInt(page),
      domain,
      role,
      startDate,
      endDate,
    }

    const chatHistory = await ChatMessage.getChatHistory(userId, options)

    res.status(200).json({
      success: true,
      message: "✅ Chat history retrieved successfully",
      data: chatHistory,
    })
  } catch (error) {
    console.error("🚨 Get Chat History Error:", error)
    res.status(500).json({
      success: false,
      message: "🔥 Failed to retrieve chat history",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    })
  }
}

// @desc    Get user's chat sessions
// @route   GET /api/chat/sessions
// @access  Private
const getChatSessions = async (req, res) => {
  try {
    const userId = req.user._id
    const { limit = 20, page = 1 } = req.query

    const skip = (page - 1) * limit

    // Get unique sessions with latest message info
    const sessions = await ChatMessage.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId),
          isDeleted: false,
        },
      },
      {
        $group: {
          _id: "$sessionId",
          lastMessage: { $last: "$message" },
          lastMessageTime: { $last: "$createdAt" },
          messageCount: { $sum: 1 },
          domain: { $last: "$metadata.domain" },
          mode: { $last: "$metadata.mode" },
        },
      },
      { $sort: { lastMessageTime: -1 } },
      { $skip: skip },
      { $limit: Number.parseInt(limit) },
    ])

    const total = await ChatMessage.distinct("sessionId", {
      userId,
      isDeleted: false,
    })

    res.status(200).json({
      success: true,
      message: "✅ Chat sessions retrieved successfully",
      data: {
        sessions,
        pagination: {
          current: Number.parseInt(page),
          total: Math.ceil(total.length / limit),
          hasNext: page < Math.ceil(total.length / limit),
          hasPrev: page > 1,
        },
        total: total.length,
      },
    })
  } catch (error) {
    console.error("🚨 Get Chat Sessions Error:", error)
    res.status(500).json({
      success: false,
      message: "🔥 Failed to retrieve chat sessions",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    })
  }
}

// @desc    Delete chat session
// @route   DELETE /api/chat/session/:sessionId
// @access  Private
const deleteChatSession = async (req, res) => {
  try {
    const { sessionId } = req.params
    const userId = req.user._id

    // Soft delete all messages in the session
    const result = await ChatMessage.updateMany(
      { userId, sessionId, isDeleted: false },
      {
        isDeleted: true,
        deletedAt: new Date(),
      },
    )

    if (result.modifiedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "🔍 Chat session not found",
      })
    }

    res.status(200).json({
      success: true,
      message: "✅ Chat session deleted successfully",
      data: {
        deletedMessages: result.modifiedCount,
      },
    })
  } catch (error) {
    console.error("🚨 Delete Chat Session Error:", error)
    res.status(500).json({
      success: false,
      message: "🔥 Failed to delete chat session",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    })
  }
}

// @desc    Update message reaction
// @route   PUT /api/chat/message/:messageId/reaction
// @access  Private
const updateMessageReaction = async (req, res) => {
  try {
    const { messageId } = req.params
    const { liked, helpful, rating } = req.body
    const userId = req.user._id

    const message = await ChatMessage.findOne({
      _id: messageId,
      userId,
      isDeleted: false,
    })

    if (!message) {
      return res.status(404).json({
        success: false,
        message: "🔍 Message not found",
      })
    }

    // Update reactions
    const updateData = {}
    if (typeof liked === "boolean") updateData["reactions.liked"] = liked
    if (typeof helpful === "boolean") updateData["reactions.helpful"] = helpful
    if (rating && rating >= 1 && rating <= 5) updateData["reactions.rating"] = rating

    const updatedMessage = await ChatMessage.findByIdAndUpdate(messageId, updateData, { new: true })

    res.status(200).json({
      success: true,
      message: "✅ Message reaction updated successfully",
      data: {
        message: updatedMessage,
      },
    })
  } catch (error) {
    console.error("🚨 Update Message Reaction Error:", error)
    res.status(500).json({
      success: false,
      message: "🔥 Failed to update message reaction",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    })
  }
}

// @desc    Get session statistics
// @route   GET /api/chat/session/:sessionId/stats
// @access  Private
const getSessionStats = async (req, res) => {
  try {
    const { sessionId } = req.params
    const userId = req.user._id

    const stats = await ChatMessage.getSessionStats(userId, sessionId)

    res.status(200).json({
      success: true,
      message: "✅ Session statistics retrieved successfully",
      data: { stats },
    })
  } catch (error) {
    console.error("🚨 Get Session Stats Error:", error)
    res.status(500).json({
      success: false,
      message: "🔥 Failed to retrieve session statistics",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    })
  }
}

module.exports = {
  sendMessage,
  getChatHistory,
  getChatSessions,
  deleteChatSession,
  updateMessageReaction,
  getSessionStats,
}
