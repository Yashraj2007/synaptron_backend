// server/routes/ingest.js
const express = require('express');
const router = express.Router();
const {
  startIngestion,
  getIngestionProgress,
  analyzeDomain,
  crawlKnowledge,
  processInformation,
  buildKnowledgeGraph,
  optimizeNeuralPathways,
  getCrawlerStats,
  getActiveIngestions,
  testCrawler
} = require('../controllers/ingestController');
const puppeteer = require('puppeteer');

// 🔥 FIXED: Import all models correctly
const DomainIngestion = require('../models/DomainIngestion');
const { KnowledgeGraph, CrawledDocument } = require('../models/DomainIngestion');

// Main ingestion workflow
router.post('/start', startIngestion);
router.get('/progress/:sessionId', getIngestionProgress);
router.get('/active', getActiveIngestions);

// Get knowledge graph by domain
router.get('/knowledge-graph/:domain', async (req, res) => {
  try {
    const ingestion = await DomainIngestion.findOne({ 
      domain: req.params.domain,
      status: 'completed',
      success: true
    }).sort({ completedAt: -1 });
    
    if (!ingestion || !ingestion.knowledgeGraph) {
      return res.status(404).json({ 
        success: false, 
        message: `No completed knowledge graph found for domain: ${req.params.domain}` 
      });
    }
    
    res.json({ 
      success: true, 
      knowledgeGraph: ingestion.knowledgeGraph,
      domain: ingestion.domain,
      sessionId: ingestion.sessionId,
      completedAt: ingestion.completedAt
    });
  } catch (error) {
    console.error('Error fetching knowledge graph:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error while fetching knowledge graph' 
    });
  }
});

// 🔥 DASHBOARD ENDPOINT
// 🔥 DASHBOARD ENDPOINT - FIXED to show ALL crawled data
router.get('/dashboard/:domain', async (req, res) => {
  try {
    const { domain } = req.params;
    
    console.log('📊 Dashboard request for domain:', domain);
    
    // Get latest completed ingestion
    const latestIngestion = await DomainIngestion.findOne({ 
      domain: domain,
      status: 'completed'
    }).sort({ completedAt: -1 });

    console.log('Latest ingestion found:', latestIngestion ? 'YES' : 'NO');

    if (!latestIngestion) {
      console.log('⚠️ No completed ingestion found, returning empty dashboard');
      return res.json({
        success: true,
        dashboard: {
          domain: domain,
          ingestionStatus: 'not_started',
          stats: {
            totalConcepts: 0,
            totalConnections: 0,
            totalResources: 0,
            academicPapers: 0,
            technicalDocs: 0,
            codeRepos: 0,
            videoTutorials: 0,
            expertInterviews: 0,
            industryReports: 0
          },
          recentActivities: [],
          analysis: null,
          crawledData: null
        }
      });
    }

    // Get knowledge graph from ingestion itself
    const knowledgeGraph = latestIngestion.knowledgeGraph;
    console.log('Knowledge graph found:', knowledgeGraph ? 'YES' : 'NO');

    // 🔥 GET ALL CRAWLED DATA from collectionResults.rawData
    const crawledData = latestIngestion.collectionResults?.rawData || {};
    console.log('Crawled data keys:', Object.keys(crawledData));

    // Extract resources from rawData
    let allResources = [];
    let resourceCounts = {
      academicPapers: 0,
      technicalDocs: 0,
      codeRepos: 0,
      videoTutorials: 0,
      expertInterviews: 0,
      industryReports: 0
    };

    // Parse crawled data - it might have different structures
    if (crawledData.academicPapers) {
      resourceCounts.academicPapers = crawledData.academicPapers.length || 0;
      allResources.push(...(crawledData.academicPapers || []).map(item => ({
        ...item,
        type: 'academic_paper'
      })));
    }

    if (crawledData.technicalDocs) {
      resourceCounts.technicalDocs = crawledData.technicalDocs.length || 0;
      allResources.push(...(crawledData.technicalDocs || []).map(item => ({
        ...item,
        type: 'technical_doc'
      })));
    }

    if (crawledData.codeRepos) {
      resourceCounts.codeRepos = crawledData.codeRepos.length || 0;
      allResources.push(...(crawledData.codeRepos || []).map(item => ({
        ...item,
        type: 'code_repo'
      })));
    }

    if (crawledData.videoTutorials) {
      resourceCounts.videoTutorials = crawledData.videoTutorials.length || 0;
      allResources.push(...(crawledData.videoTutorials || []).map(item => ({
        ...item,
        type: 'video_tutorial'
      })));
    }

    if (crawledData.expertInterviews) {
      resourceCounts.expertInterviews = crawledData.expertInterviews.length || 0;
      allResources.push(...(crawledData.expertInterviews || []).map(item => ({
        ...item,
        type: 'expert_interview'
      })));
    }

    if (crawledData.industryReports) {
      resourceCounts.industryReports = crawledData.industryReports.length || 0;
      allResources.push(...(crawledData.industryReports || []).map(item => ({
        ...item,
        type: 'industry_report'
      })));
    }

    console.log('Total resources extracted:', allResources.length);

    // Also check CrawledDocument collection
    const crawledDocuments = await CrawledDocument.find({ domain: domain });
    console.log('Crawled documents from separate collection:', crawledDocuments.length);

    // Merge both sources
    if (crawledDocuments.length > 0) {
      crawledDocuments.forEach(doc => {
        allResources.push({
          title: doc.title,
          url: doc.url,
          type: doc.sourceType,
          summary: doc.content?.summary,
          concepts: doc.content?.extractedConcepts || [],
          keyPoints: doc.content?.keyPoints || [],
          createdAt: doc.createdAt
        });
      });
    }

    // Recent activities from crawled data
    const recentActivities = allResources
      .slice(0, 10)
      .map((resource, idx) => ({
        text: `Added ${resource.type?.replace('_', ' ') || 'resource'} - ${resource.title || 'Untitled'}`,
        time: resource.createdAt ? new Date(resource.createdAt).toLocaleString() : 'Recently',
        type: resource.type || 'unknown'
      }));

    const dashboardData = {
      domain: domain,
      ingestionStatus: latestIngestion.status,
      completedAt: latestIngestion.completedAt,
      totalDuration: latestIngestion.totalDuration,
      
      stats: {
        totalConcepts: knowledgeGraph?.nodes?.length || 0,
        totalConnections: knowledgeGraph?.edges?.length || 0,
        totalResources: allResources.length,
        academicPapers: resourceCounts.academicPapers + crawledDocuments.filter(d => d.sourceType === 'academic_paper').length,
        technicalDocs: resourceCounts.technicalDocs + crawledDocuments.filter(d => d.sourceType === 'technical_doc').length,
        codeRepos: resourceCounts.codeRepos + crawledDocuments.filter(d => d.sourceType === 'code_repo').length,
        videoTutorials: resourceCounts.videoTutorials + crawledDocuments.filter(d => d.sourceType === 'video_tutorial').length,
        expertInterviews: resourceCounts.expertInterviews + crawledDocuments.filter(d => d.sourceType === 'expert_interview').length,
        industryReports: resourceCounts.industryReports + crawledDocuments.filter(d => d.sourceType === 'industry_report').length
      },

      analysis: latestIngestion.analysisResults,
      recentActivities: recentActivities,
      
      // 🔥 ALL CRAWLED RESOURCES
      allResources: allResources
    };

    console.log('✅ Dashboard data prepared successfully');
    console.log('Stats:', dashboardData.stats);

    res.json({
      success: true,
      dashboard: dashboardData
    });

  } catch (error) {
    console.error('❌ Dashboard API Error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
      error: error.toString()
    });
  }
});

// 🔥 RESOURCES ENDPOINT
router.get('/resources/:domain', async (req, res) => {
  try {
    const { domain } = req.params;
    const { type } = req.query;

    console.log('📚 Resources request for domain:', domain, 'type:', type);

    let query = { domain };
    if (type) {
      query.sourceType = type;
    }

    const documents = await CrawledDocument.find(query).sort({ createdAt: -1 });
    console.log('Found', documents.length, 'resources');

    res.json({
      success: true,
      total: documents.length,
      resources: documents.map(doc => ({
        id: doc._id,
        title: doc.title,
        type: doc.sourceType,
        url: doc.url,
        summary: doc.content?.summary,
        concepts: doc.content?.extractedConcepts || [],
        keyPoints: doc.content?.keyPoints || [],
        status: doc.processingStatus,
        createdAt: doc.createdAt
      }))
    });

  } catch (error) {
    console.error('❌ Resources API Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 🔥 AI RESOURCE ANALYSIS ENDPOINT
// 🔥 FINAL BULLETPROOF: AI Resource Analysis with Type Filtering
router.post('/analyze-resources/:domain', async (req, res) => {
  try {
    const { domain } = req.params;
    const { resourceType } = req.body;
    
    console.log('🤖 Analyzing for:', domain);
    console.log('📌 Resource Type:', resourceType || 'ALL');
    
    const latestIngestion = await DomainIngestion.findOne({ 
      domain: domain,
      status: 'completed'
    }).sort({ completedAt: -1 });

    if (!latestIngestion) {
      return res.json({ success: false, message: 'No ingestion found' });
    }

    const crawledData = latestIngestion.collectionResults?.rawData || {};
    
    console.log('Available data keys:', Object.keys(crawledData));
    
    // Type mapping
    const typeToKey = {
      'academic_paper': 'academicPapers',
      'technical_doc': 'technicalDocs',
      'code_repo': 'codeRepos',
      'video_tutorial': 'videoTutorials',
      'expert_interview': 'expertInterviews',
      'industry_report': 'industryReports'
    };

    let resources = [];
    let typeLabel = 'ALL RESOURCES';

    // Filter by type
    if (resourceType && typeToKey[resourceType]) {
      const dataKey = typeToKey[resourceType];
      resources = crawledData[dataKey] || [];
      typeLabel = resourceType.replace('_', ' ').toUpperCase();
      console.log(`✅ Filtered to ${resources.length} ${typeLabel}`);
    } else {
      // Get all
      Object.values(typeToKey).forEach(key => {
        if (crawledData[key]) {
          resources.push(...crawledData[key]);
        }
      });
      console.log(`✅ Total ${resources.length} resources`);
    }

    if (resources.length === 0) {
      return res.json({ 
        success: false, 
        message: `No ${typeLabel} found` 
      });
    }

    // Prepare for AI (limit 25)
    const forAI = resources.slice(0, 25).map((r, i) => {
      const title = r.title || r.name || r.repo || r.full_name || 'Untitled';
      return {
        id: i + 1,
        title: title,
        description: (r.description || r.summary || '').substring(0, 200),
        url: r.url || r.html_url || r.link || '',
        author: r.author || r.owner?.login || '',
        stars: r.stars || r.stargazers_count || 0,
        language: r.language || '',
      };
    }).filter(r => r.title !== 'Untitled');

    console.log(`📤 Sending ${forAI.length} resources to AI`);

    if (forAI.length === 0) {
      return res.json({ success: false, message: 'No valid resources' });
    }

    // AI Prompt based on type
    let prompt = '';
    
    if (resourceType === 'code_repo') {
      prompt = `You are analyzing ${forAI.length} CODE REPOSITORIES for learning ${domain}.

REPOSITORIES:
${forAI.map(r => `${r.id}. **${r.title}**
   - Description: ${r.description}
   - Stars: ${r.stars}
   - Language: ${r.language}
   - URL: ${r.url}`).join('\n\n')}

Provide analysis in plain text (NO MARKDOWN):

1. OVERVIEW (2-3 sentences): What do these repos cover overall?

2. TOP 5 REPOS:
List the 5 best repositories with specific reasons:
- Repo 1: [name] - Why it's valuable
- Repo 2: [name] - Why it's valuable
etc.

3. LEARNING PATH (3 weeks):
Week 1: [Which repos to explore first]
Week 2: [Which repos next]
Week 3: [Which repos for advanced learning]

4. SKILLS: What programming skills will you learn?

Keep it concise and specific. Use actual repo names from the list.`;

    } else if (resourceType === 'video_tutorial') {
      prompt = `Analyze ${forAI.length} VIDEO TUTORIALS for ${domain}.

VIDEOS:
${forAI.map(r => `${r.id}. ${r.title}\n   ${r.description}`).join('\n\n')}

Provide (NO MARKDOWN):

1. OVERVIEW: What topics do these videos cover?

2. TOP 5 VIDEOS:
List with reasons for each

3. WATCH ORDER (3 weeks):
Week 1: [Which videos]
Week 2: [Which videos]
Week 3: [Which videos]

4. KEY LEARNINGS: What you'll learn

Use actual video titles.`;

    } else if (resourceType === 'academic_paper') {
      prompt = `Analyze ${forAI.length} ACADEMIC PAPERS for ${domain}.

PAPERS:
${forAI.map(r => `${r.id}. ${r.title}\n   ${r.description}`).join('\n\n')}

Provide (NO MARKDOWN):

1. RESEARCH OVERVIEW: What research areas?

2. TOP 5 PAPERS:
List with why each is important

3. READING ORDER (3 weeks):
Week 1: [Which papers]
Week 2: [Which papers]
Week 3: [Which papers]

4. RESEARCH INSIGHTS: Key findings

Use actual paper titles.`;

    } else {
      prompt = `Analyze ${forAI.length} ${typeLabel} for ${domain}.

RESOURCES:
${forAI.map(r => `${r.id}. ${r.title}\n   ${r.description}`).join('\n\n')}

Provide analysis (NO MARKDOWN):

1. OVERVIEW: What's covered?

2. TOP 5 RESOURCES:
List with reasons

3. LEARNING PATH (3 weeks):
Week 1-3 breakdown

4. KEY TAKEAWAYS

Use actual resource titles.`;
    }

    console.log('📡 Calling OpenRouter API...');

    const apiResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer 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",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "qwen/qwen2.5-vl-72b-instruct:free",
        messages: [
          { role: "user", content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 2000,
      }),
    });

    const apiData = await apiResponse.json();
    const aiResponse = apiData.choices?.[0]?.message?.content || "Analysis failed";

    console.log('✅ AI Response received:', aiResponse.substring(0, 150));

    // Parse sections
    const sections = {
      overview: '',
      topPicks: '',
      learningPath: '',
      skills: ''
    };

    const lines = aiResponse.split('\n');
    let currentSection = '';

    lines.forEach(line => {
      const lower = line.toLowerCase();
      if (lower.includes('overview') || lower.includes('1.')) {
        currentSection = 'overview';
      } else if (lower.includes('top 5') || lower.includes('2.')) {
        currentSection = 'topPicks';
      } else if (lower.includes('learning') || lower.includes('week') || lower.includes('3.')) {
        currentSection = 'learningPath';
      } else if (lower.includes('skill') || lower.includes('key') || lower.includes('4.')) {
        currentSection = 'skills';
      } else if (currentSection && line.trim()) {
        sections[currentSection] += line + '\n';
      }
    });

    const result = {
      resourceType: resourceType || 'all',
      typeLabel: typeLabel,
      totalCount: resources.length,
      analyzedCount: forAI.length,
      summary: {
        coverage: sections.overview.trim() || aiResponse.substring(0, 300),
        quality: `Analyzed ${forAI.length} ${typeLabel.toLowerCase()} from the knowledge base`,
        recommendation: sections.learningPath.substring(0, 200) || 'Follow structured learning approach'
      },
      topPicks: forAI.slice(0, 5).map((r, i) => ({
        rank: i + 1,
        title: r.title,
        url: r.url,
        stars: r.stars,
        language: r.language,
        description: r.description
      })),
      learningPath: [
        {
          week: 1,
          phase: "Foundation",
          focus: `Core ${domain} concepts`,
          resources: forAI.slice(0, 3).map(r => r.title),
          estimatedHours: 10
        },
        {
          week: 2,
          phase: "Practice",
          focus: "Hands-on implementation",
          resources: forAI.slice(3, 6).map(r => r.title),
          estimatedHours: 15
        },
        {
          week: 3,
          phase: "Advanced",
          focus: "Deep dive",
          resources: forAI.slice(6, 9).map(r => r.title),
          estimatedHours: 20
        }
      ],
      fullAnalysis: aiResponse,
      topPicksText: sections.topPicks.trim(),
      learningPathText: sections.learningPath.trim(),
      skillsText: sections.skills.trim()
    };

    console.log('✅ Analysis complete and structured');

    res.json({
      success: true,
      domain,
      resourceType: resourceType || 'all',
      aiAnalysis: result
    });

  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
// Add this to routes/ingest.js

// 🔥 NEW: Analyze Industry Report and Generate PDF

router.post('/analyze-report', async (req, res) => {
  try {
    const { reportTitle, reportContent, reportUrl, domain } = req.body;
    
    console.log('📊 STARTING REPORT ANALYSIS');
    console.log('Title:', reportTitle);
    console.log('URL:', reportUrl);

    let scrapedContent = '';
    let scrapingSuccess = false;
    
    // 🔥 TRY TO SCRAPE
    try {
      console.log('🕷️ Attempting to scrape content...');
      
      const browser = await puppeteer.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
      
      await page.goto(reportUrl, { 
        waitUntil: 'domcontentloaded', 
        timeout: 30000 
      });
      
      await page.waitForTimeout(2000);
      
      scrapedContent = await page.evaluate(() => {
        // Remove unwanted elements
        const unwanted = document.querySelectorAll('script, style, nav, footer, header, .advertisement, .cookie, .sidebar');
        unwanted.forEach(el => el.remove());
        
        // Get main content
        const main = document.querySelector('main, article, .content, .main-content, #content');
        if (main) return main.innerText;
        
        // Fallback to body
        return document.body.innerText;
      });
      
      await browser.close();
      
      // Clean and limit content
      scrapedContent = scrapedContent
        .replace(/\s+/g, ' ')
        .replace(/\n+/g, '\n')
        .trim()
        .substring(0, 12000);
      
      if (scrapedContent.length > 500) {
        scrapingSuccess = true;
        console.log('✅ Scraping successful! Length:', scrapedContent.length);
      } else {
        throw new Error('Insufficient content scraped');
      }
      
    } catch (scrapeError) {
      console.log('⚠️ Scraping failed:', scrapeError.message);
      scrapedContent = reportContent || '';
    }

    // 🔥 PREPARE CONTENT FOR AI
    const finalContent = scrapedContent || reportContent || `Report about ${domain} trends and analysis`;
    
    console.log('📝 Final content length:', finalContent.length);

    // 🔥 SMART PROMPT - Works even with limited content
    const prompt = `You are a professional ${domain} industry analyst creating a comprehensive report.

REPORT INFORMATION:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Title: ${reportTitle}
Source: ${reportUrl}
Domain: ${domain}
Content Available: ${finalContent.length} characters

EXTRACTED CONTENT:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${finalContent}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

YOUR TASK: Create a detailed professional analysis report.

${scrapingSuccess ? 
`Based on the ACTUAL content above, analyze it in depth.` : 
`The report discusses ${domain}. Use your expert knowledge to create an analysis of typical ${domain} industry trends, focusing on what this type of report would cover.`}

REQUIRED FORMAT:

╔══════════════════════════════════════════════════╗
║  EXECUTIVE SUMMARY                                ║
╚══════════════════════════════════════════════════╝

[Write 3-4 paragraphs summarizing the key aspects of ${domain} covered in this type of report. ${scrapingSuccess ? 'Reference specific details from the content above.' : 'Focus on typical industry insights for ' + domain}]

╔══════════════════════════════════════════════════╗
║  KEY FINDINGS                                     ║
╚══════════════════════════════════════════════════╝

Finding #1: [Title]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• What: [Detailed explanation]
• Why Important: [Significance for ${domain}]
• Evidence: ${scrapingSuccess ? '[Reference from content]' : '[Industry knowledge]'}
• Impact: [Future implications]

Finding #2: [Title]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[Same structure, repeat 7-10 times]

╔══════════════════════════════════════════════════╗
║  MARKET TRENDS & INSIGHTS                        ║
╚══════════════════════════════════════════════════╝

📈 CURRENT LANDSCAPE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[4-5 paragraphs analyzing current ${domain} market state, technologies, adoption rates, key players]

🚀 EMERGING DEVELOPMENTS  
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[4-5 paragraphs on new trends, innovations, disruptions in ${domain}]

🔮 FUTURE OUTLOOK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[4-5 paragraphs on predictions, growth areas, challenges ahead]

╔══════════════════════════════════════════════════╗
║  IMPLICATIONS FOR ${domain.toUpperCase()} LEARNERS   ║
╚══════════════════════════════════════════════════╝

👨‍🎓 FOR STUDENTS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[5-6 paragraphs covering:
• Critical skills to develop
• Technologies to master
• Learning pathways
• Timeline recommendations
• Resource suggestions]

💼 FOR PROFESSIONALS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[5-6 paragraphs covering:
• Upskilling strategies
• Career opportunities
• Salary trends
• Competitive advantages]

╔══════════════════════════════════════════════════╗
║  ACTIONABLE RECOMMENDATIONS                      ║
╚══════════════════════════════════════════════════╝

⚡ IMMEDIATE (Next 30 Days):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. [Action] → Why: [Reason] → How: [Method] → Outcome: [Result]
2. [Action] → Why: [Reason] → How: [Method] → Outcome: [Result]
[List 7-10 specific actions]

📅 SHORT-TERM (3-6 Months):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. [Goal] → Steps: [Details] → Success Metrics: [Measures]
2. [Goal] → Steps: [Details] → Success Metrics: [Measures]
[List 7-10 goals]

🎯 LONG-TERM (6-12 Months):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. [Strategy] → Implementation: [Plan] → Expected Impact: [Result]
2. [Strategy] → Implementation: [Plan] → Expected Impact: [Result]
[List 5-7 strategies]

╔══════════════════════════════════════════════════╗
║  SKILLS & TECHNOLOGIES ROADMAP                   ║
╚══════════════════════════════════════════════════╝

🎓 MUST-LEARN SKILLS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Skill #1: [Name]
• Why Critical: [Detailed explanation]
• Learning Path: [Specific steps]
• Time Commitment: [Estimate]
• Resources: [Where to learn]
• Market Demand: [High/Medium/Low and why]

[Repeat for 8-10 skills]

🛠️ KEY TOOLS & PLATFORMS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Tool #1: [Name]
• Purpose: [What it does]
• Industry Adoption: [Widespread/Growing/Niche]
• Learning Curve: [Assessment]
• Priority Level: [Ranking and justification]

[List 8-10 tools]

╔══════════════════════════════════════════════════╗
║  CRITICAL ANALYSIS                               ║
╚══════════════════════════════════════════════════╝

✅ REPORT STRENGTHS:
[3-4 paragraphs analyzing ${scrapingSuccess ? 'the quality and value of this specific report' : 'typical value of ' + domain + ' industry reports'}]

⚠️ LIMITATIONS:
[3-4 paragraphs on ${scrapingSuccess ? 'gaps in this report' : 'common limitations in ' + domain + ' reports'}]

📚 COMPLEMENTARY RESOURCES:
[3-4 paragraphs suggesting additional research areas]

╔══════════════════════════════════════════════════╗
║  CONCLUSION                                      ║
╚══════════════════════════════════════════════════╝

🎯 TOP 3 TAKEAWAYS:
1. [Most critical insight and why]
2. [Second most important and why]
3. [Third most important and why]

⚡ MUST-DO ACTIONS:
[3-4 paragraphs on essential immediate steps]

🚀 FUTURE-PROOFING:
[3-4 paragraphs on staying ahead in ${domain}]

💡 FINAL PERSPECTIVE:
[2-3 paragraphs with concluding expert commentary]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

REQUIREMENTS:
✓ Be extremely detailed (4000-5000 words)
✓ Use professional language
✓ ${scrapingSuccess ? 'Reference actual content when possible' : 'Use expert industry knowledge'}
✓ Each section must be comprehensive
✓ Include specific actionable recommendations
✓ Maintain the exact formatting with borders
✓ Focus on practical value for ${domain} learners

Generate the complete analysis now:`;

    console.log('🤖 Calling AI...');

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer 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",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "meta-llama/llama-3.3-70b-instruct:free",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.8,
        max_tokens: 8000,
      }),
    });

    if (!response.ok) {
      throw new Error(`AI API error: ${response.status}`);
    }

    const data = await response.json();
    const analysis = data.content?.[0]?.text || data.choices?.[0]?.message?.content || "Analysis unavailable";

    console.log('✅ Analysis complete! Length:', analysis.length);

    res.json({
      success: true,
      report: {
        title: reportTitle,
        originalUrl: reportUrl,
        domain: domain,
        analysis: analysis,
        scrapingSuccess: scrapingSuccess,
        contentLength: finalContent.length,
        generatedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


// Get list of all available domains with completed knowledge graphs
router.get('/domains', async (req, res) => {
  try {
    const domains = await DomainIngestion.distinct('domain', { 
      status: 'completed',
      success: true,
      'knowledgeGraph.nodes': { $exists: true, $not: { $size: 0 } }
    });
    res.json({ success: true, domains });
  } catch (error) {
    console.error('Error fetching domains:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});
// 🔥 Chat with history
router.post('/chat', async (req, res) => {
  try {
    const { candidateId, domain, question } = req.body;

    // Get candidate with conversation history
    const candidate = await Candidate.findById(candidateId);
    if (!candidate) {
      return res.status(404).json({ success: false, error: 'Candidate not found' });
    }

    // Get existing conversation for this domain
    const conversationKey = domain.toLowerCase().replace(/\s+/g, '_');
    const existingHistory = candidate.conversationHistory?.get(conversationKey) || [];

    // Build conversation context (last 10 messages to keep it relevant)
    const recentHistory = existingHistory.slice(-10);
    const messages = [
      {
        role: "system",
        content: `You are an AI assistant helping with ${domain} learning. Provide detailed, accurate answers based on the conversation history.`
      },
      ...recentHistory.map(msg => ({
        role: msg.role,
        content: msg.content
      })),
      {
        role: "user",
        content: question
      }
    ];

    // Call AI
    const aiResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer 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",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "qwen/qwen2.5-vl-72b-instruct:free",
        messages: messages,
        temperature: 0.7,
        max_tokens: 2000,
      }),
    });

    const aiData = await aiResponse.json();
    const answer = aiData.choices?.[0]?.message?.content || "I couldn't generate a response.";

    // 🔥 Save conversation history
    const updatedHistory = [
      ...existingHistory,
      { role: 'user', content: question, timestamp: new Date() },
      { role: 'assistant', content: answer, timestamp: new Date() }
    ];

    candidate.conversationHistory.set(conversationKey, updatedHistory);
    await candidate.save();

    res.json({
      success: true,
      answer: answer,
      conversationCount: updatedHistory.length
    });

  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 🔥 Get conversation history
router.get('/conversation-history/:candidateId/:domain', async (req, res) => {
  try {
    const { candidateId, domain } = req.params;
    
    const candidate = await Candidate.findById(candidateId);
    if (!candidate) {
      return res.status(404).json({ success: false, error: 'Candidate not found' });
    }

    const conversationKey = domain.toLowerCase().replace(/\s+/g, '_');
    const history = candidate.conversationHistory?.get(conversationKey) || [];

    res.json({
      success: true,
      history: history
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 🔥 Clear conversation history
router.delete('/conversation-history/:candidateId/:domain', async (req, res) => {
  try {
    const { candidateId, domain } = req.params;
    
    const candidate = await Candidate.findById(candidateId);
    if (!candidate) {
      return res.status(404).json({ success: false, error: 'Candidate not found' });
    }

    const conversationKey = domain.toLowerCase().replace(/\s+/g, '_');
    candidate.conversationHistory.delete(conversationKey);
    await candidate.save();

    res.json({ success: true, message: 'Conversation history cleared' });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
router.get('/user-history/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    console.log('📊 Fetching COMPLETE history for user:', userId);
    
    // Get ALL domain ingestions with full details
    const allIngestions = await DomainIngestion.find({})
      .sort({ createdAt: -1 })
      .lean(); // Use lean() for better performance
    
    console.log(`Found ${allIngestions.length} total ingestions`);
    
    // For each ingestion, get ALL related data
    const detailedIngestions = await Promise.all(
      allIngestions.map(async (ingestion) => {
        // Get knowledge graph
        const kg = await KnowledgeGraph.findOne({ 
          sessionId: ingestion.sessionId 
        }).lean();
        
        // Get ALL crawled documents for this ingestion's domain
        const crawledDocs = await CrawledDocument.find({ 
          domain: ingestion.domain 
        }).lean();
        
        return {
          _id: ingestion._id,
          domain: ingestion.domain,
          sessionId: ingestion.sessionId,
          status: ingestion.status,
          progress: ingestion.progress,
          currentStep: ingestion.currentStep,
          
          // Analysis Results
          analysisResults: ingestion.analysisResults,
          
          // Collection Results
          collectionResults: ingestion.collectionResults,
          
          // Processing Results
          processingResults: ingestion.processingResults,
          
          // Knowledge Graph Data (from ingestion doc)
          knowledgeGraph: ingestion.knowledgeGraph,
          
          // Optimization Data
          optimization: ingestion.optimization,
          
          // Crawl Stats
          crawlStats: ingestion.crawlStats,
          
          // Timestamps
          createdAt: ingestion.createdAt,
          updatedAt: ingestion.updatedAt,
          startTime: ingestion.startTime,
          completedAt: ingestion.completedAt,
          totalDuration: ingestion.totalDuration,
          
          // Success/Error
          success: ingestion.success,
          error: ingestion.error,
          
          // Related Data
          knowledgeGraphData: kg, // Separate KG document
          crawledDocuments: crawledDocs, // ALL docs for this domain
          crawledDocCount: crawledDocs.length
        };
      })
    );
    
    // Calculate overall stats
    const totalConcepts = allIngestions.reduce((sum, ing) => 
      sum + (ing.crawlStats?.conceptsExtracted || 0), 0);
    
    const totalDocuments = allIngestions.reduce((sum, ing) => 
      sum + (ing.crawlStats?.documentsProcessed || 0), 0);
    
    const totalConnections = allIngestions.reduce((sum, ing) => 
      sum + (ing.crawlStats?.neuralConnections || 0), 0);
    
    const completedIngestions = allIngestions.filter(ing => ing.status === 'completed');
    const failedIngestions = allIngestions.filter(ing => ing.status === 'failed');
    const inProgressIngestions = allIngestions.filter(ing => 
      ing.status !== 'completed' && ing.status !== 'failed'
    );
    
    // Get total crawled documents
    const totalCrawledDocs = await CrawledDocument.countDocuments();
    
    // Get unique domains
    const uniqueDomains = [...new Set(allIngestions.map(ing => ing.domain))];
    
    console.log('✅ History compiled successfully');
    console.log(`   - ${allIngestions.length} ingestions`);
    console.log(`   - ${totalCrawledDocs} crawled documents`);
    console.log(`   - ${uniqueDomains.length} unique domains`);
    
    res.json({
      success: true,
      history: {
        totalIngestions: allIngestions.length,
        totalCrawledDocs: totalCrawledDocs,
        totalUniqueDomains: uniqueDomains.length,
        ingestions: detailedIngestions, // ALL ingestions with FULL nested data
        stats: {
          completed: completedIngestions.length,
          inProgress: inProgressIngestions.length,
          failed: failedIngestions.length,
          totalConcepts: totalConcepts,
          totalDocuments: totalDocuments,
          totalConnections: totalConnections,
          averageProgress: Math.floor(
            allIngestions.reduce((sum, ing) => sum + ing.progress, 0) / allIngestions.length
          ) || 0
        }
      }
    });
    
  } catch (error) {
    console.error('❌ History fetch error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Individual step endpoints
router.post('/analyze-domain', analyzeDomain);
router.post('/crawl-knowledge', crawlKnowledge);
router.post('/process-information', processInformation);
router.post('/build-knowledge-graph', buildKnowledgeGraph);
router.post('/optimize-neural-pathways', optimizeNeuralPathways);

// Utility endpoints
router.get('/crawler-stats', getCrawlerStats);
router.post('/test-crawler', testCrawler);

module.exports = router;
