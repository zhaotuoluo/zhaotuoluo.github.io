const urlInput = document.querySelector("#urlInput");
const noteInput = document.querySelector("#noteInput");
const goalInput = document.querySelector("#goalInput");
const toneInput = document.querySelector("#toneInput");
const generateButton = document.querySelector("#generateButton");
const statusPill = document.querySelector("#statusPill");
const pageCard = document.querySelector("#pageCard");
const comments = document.querySelector("#comments");
const copyAllButton = document.querySelector("#copyAllButton");

let currentComments = [];
let currentFollowUp = "";
let appConfig = {
  requestTimeoutMs: 5500,
  analyzeApis: ["https://creator-comment-assistant.vercel.app/api/analyze"],
  readerProxies: ["codetabs", "allorigins"]
};

function cleanText(value = "") {
  return value.replace(/\s+/g, " ").trim();
}

function stripNoise(value = "") {
  return cleanText(value)
    .replace(/https?:\/\/\S+/g, "")
    .replace(/(博主|作者|老师)?这条(作品|视频|笔记|文章|内容)?(主要)?(讲的是|讲了|分享的是|分享了|提到的是|提到了)?/g, "")
    .replace(/(我们|我|你|对方|后续|最近|持续关注|想|看看|是否|适合|合作|方向|相关|问题)/g, "")
    .replace(/[“”"'《》<>]/g, "")
    .trim();
}

function extractDeclaredTopic(source) {
  const match = source.match(/(?:讲的是|讲了|分享的是|分享了|提到的是|提到了|主题是|内容是|核心观点是|核心是)([^。；\n]{4,48})/);
  if (!match) return "";
  return stripNoise(match[1]).replace(/[，,].*$/, "").slice(0, 28);
}

function pickTopic(page, note) {
  const source = [note, page.title, page.description, page.content].filter(Boolean).join(" ");
  const declaredTopic = extractDeclaredTopic(source);
  if (declaredTopic) return declaredTopic;

  const candidates = stripNoise(source)
    .split(/[。；;，,、\n]/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 4 && item.length <= 28)
    .filter((item) => !/^(可选|链接|标题|摘要|输出结果|生成|复制|留言)/.test(item));

  if (candidates.length) return candidates[0];
  if (page.title) return page.title.replace(/[｜|_-].*$/, "").slice(0, 22);
  return "这个内容点";
}

function inferContentType(page, note) {
  const source = [note, page.title, page.description, page.content].filter(Boolean).join(" ");
  if (/方法|步骤|攻略|清单|教程|指南|怎么做|如何|实操|技巧|解决/.test(source)) {
    return "method";
  }
  if (/案例|故事|经历|复盘|踩坑|过程|真实/.test(source)) {
    return "case";
  }
  if (/观点|认知|思考|趋势|判断|洞察|底层逻辑/.test(source)) {
    return "viewpoint";
  }
  if (/产品|课程|社群|服务|工具|训练营|咨询/.test(source)) {
    return "offer";
  }
  return "general";
}

function analyzeCommunityFit(page, note) {
  const source = [note, page.title, page.description, page.content].filter(Boolean).join(" ");
  let score = 45;
  const reasons = [];
  const risks = [];

  const signals = [
    {
      pattern: /方法|步骤|清单|教程|指南|怎么做|如何|实操|技巧|模板|框架|路径|解决/g,
      points: 18,
      reason: "有方法论或可执行步骤，适合沉淀成连续内容"
    },
    {
      pattern: /案例|复盘|经历|故事|真实|转化|成交|增长|踩坑|过程/g,
      points: 14,
      reason: "有案例或复盘，适合延展成案例拆解"
    },
    {
      pattern: /用户|需求|问题|痛点|咨询|反馈|学员|客户|粉丝|提问/g,
      points: 16,
      reason: "能看到用户问题，适合社群里持续答疑"
    },
    {
      pattern: /课程|训练营|服务|咨询|会员|社群|陪跑|付费|产品/g,
      points: 14,
      reason: "已有产品或服务信号，付费社群承接更顺"
    },
    {
      pattern: /认知|观点|趋势|判断|洞察|底层逻辑|系统/g,
      points: 10,
      reason: "有观点体系，适合做长期主题沉淀"
    }
  ];

  signals.forEach(({ pattern, points, reason }) => {
    if (pattern.test(source)) {
      score += points;
      reasons.push(reason);
    }
  });

  if (/广告|带货|报价|下单|团购|链接|福利|抽奖|低价/.test(source)) {
    score -= 12;
    risks.push("内容偏交易或活动，评论要更克制");
  }
  if (source.length < 42) {
    score -= 8;
    risks.push("内容信息偏少，建议补充老师观点或案例");
  }

  score = Math.max(20, Math.min(96, score));
  const level = score >= 78 ? "高适配" : score >= 60 ? "可试探" : "先观察";
  const model =
    score >= 78
      ? "适合从连续答疑、案例拆解、方法陪跑切入"
      : score >= 60
        ? "适合先观察评论反馈，再用轻问题测试老师意愿"
        : "先用普通互动建立存在感，不急着往合作引";

  return {
    score,
    level,
    reasons: reasons.slice(0, 3),
    risks: risks.slice(0, 2),
    model
  };
}

function detectCreator(page) {
  if (page.author) return `${page.author}老师`;
  return "老师";
}

function sentenceFromSignal(title, topic) {
  if (!title || /留言助手|自动留言|输出结果|生成 3 条/.test(title)) {
    return `看到你讲「${topic}」这个内容`;
  }
  const shortTitle = title.length > 34 ? `${title.slice(0, 34)}...` : title;
  return `看到你这条「${shortTitle}」`;
}

function buildComments({ page, note, goal, tone }) {
  const creator = detectCreator(page);
  const topic = pickTopic(page, note);
  const contentType = inferContentType(page, note);
  const fit = analyzeCommunityFit(page, note);
  const titleSentence = sentenceFromSignal(page.title, topic);
  const toneLine =
    tone === "专业克制"
      ? "表达很清楚，信息密度也够，感觉不只是单条内容。"
      : tone === "温暖亲近"
        ? "读起来很有共鸣，也能看出你对这个问题观察得很细。"
        : "整体读下来很自然，也让人愿意继续看你后面怎么展开。";
  const contentPraise = {
    method: "你把这个问题拆得很清楚，尤其是可执行的部分很容易让人接上。",
    case: "你讲这个内容的时候有真实场景，不是单纯讲道理，所以更容易让人代入。",
    viewpoint: "你的判断挺有辨识度，能看出不是临时拼出来的观点。",
    offer: "你把背后的需求讲得比较清楚，也让人更容易理解这个方向的价值。",
    general: "你把这个点讲得很具体，读起来不是空泛表达。"
  }[contentType];
  const questionByType = {
    method: `${creator}，像你讲的「${topic}」，感觉很多人真正卡住的不是知道方法，而是没人帮他把第一步落下去。你觉得这个点是不是最难？`,
    case: `${creator}，这个「${topic}」案例挺值得继续拆的，我反而会好奇：如果换成另一个人照着做，最容易在哪一步走偏？`,
    viewpoint: `${creator}，你这个「${topic}」判断挺有意思，感觉不是一次性观点，更像能延展出一组连续讨论的话题。`,
    offer: `${creator}，像「${topic}」这种需求，感觉用户不只是想听一次，更需要有人持续帮他校准方向。你怎么看？`,
    general: `${creator}，你提到的「${topic}」挺值得继续展开的，感觉评论区应该也会有人想追问更具体的做法。`
  }[contentType];
  const thirdByGoal = {
    引发思考: {
      type: "社群暗示型",
      text: `${creator}，这个方向其实很适合做成连续拆解：先讲判断，再讲案例，再回答大家落地时遇到的问题。单条内容感觉有点讲不完。`,
      tags: ["不提合作", "引发社群联想"]
    },
    轻触达: {
      type: "轻触达型",
      text: `${creator}，你这个「${topic}」方向如果后面做成系列内容，应该会很有价值。不是单纯更新一篇，而是能持续解决一类人的问题。`,
      tags: ["轻合作感", "不露平台"]
    },
    邀请私信: {
      type: "私信引导型",
      text: `${creator}，这个方向我觉得很适合再往“持续答疑/案例拆解”的形式延展，想跟你请教下你对这类内容承接的想法，方便私信交流吗？`,
      tags: ["谨慎使用", "需人工确认"]
    }
  }[goal];

  const variants = [
    {
      type: "理解型",
      text: `${creator}，${titleSentence}，${contentPraise}${toneLine}`,
      tags: ["低打扰", "适合首次互动"]
    },
    {
      type: "追问型",
      text: questionByType,
      tags: ["引导思考", "适合评论区互动"]
    },
    thirdByGoal
  ];

  return {
    fit,
    comments: variants.map((item) => ({
      ...item,
      text: cleanText(item.text)
    })),
    followUp: buildFollowUp({ creator, topic, fit })
  };
}

function buildFollowUp({ creator, topic, fit }) {
  const angle =
    fit.score >= 78
      ? "你这类内容其实很适合做成一个持续答疑和案例拆解的付费社群"
      : "我觉得你这类内容有机会先从小范围持续交流试起来";
  return cleanText(
    `${creator}，刚刚看完你关于「${topic}」的内容，感觉不只是单篇选题，背后有一类人会持续遇到类似问题。${angle}。如果你愿意，我可以帮你一起梳理一个知识星球的主题定位和第一批内容结构，不急着推广，先看看这个方向值不值得做。`
  );
}

function renderPage(page, url, warning, analysis) {
  const fields = [
    ["链接", url || urlInput.value || "未输入链接"],
    ["标题", page.title || "未读取到标题"],
    ["作者", page.author || "未读取到作者"],
    ["依据", page.description || page.content || "未读取到正文摘要，可用内容补充生成"]
  ];
  const fit = analysis?.fit;

  pageCard.innerHTML = `
    ${warning ? `<p class="error">${warning}</p>` : ""}
    ${
      fit
        ? `<div class="fit-summary">
            <div>
              <span class="fit-label">社群适配</span>
              <strong>${escapeHtml(fit.level)} · ${fit.score}分</strong>
            </div>
            <p>${escapeHtml(fit.model)}</p>
          </div>
          <div class="fit-list">
            ${(fit.reasons.length ? fit.reasons : ["内容信息有限，先用评论测试老师是否愿意展开"]).map((reason) => `<span class="tag">${escapeHtml(reason)}</span>`).join("")}
            ${fit.risks.map((risk) => `<span class="tag warning">${escapeHtml(risk)}</span>`).join("")}
          </div>`
        : ""
    }
    <dl>
      ${fields
        .map(
          ([label, value]) => `
            <div>
              <dt>${label}</dt>
              <dd>${escapeHtml(value)}</dd>
            </div>
          `
        )
        .join("")}
    </dl>
  `;
}

function renderComments(analysis) {
  currentComments = analysis.comments;
  currentFollowUp = analysis.followUp;
  copyAllButton.disabled = !currentComments.length;
  comments.innerHTML = currentComments
    .map(
      (item, index) => `
        <article class="comment-card">
          <div class="comment-head">
            <span class="comment-type">${index + 1}. ${escapeHtml(item.type)}</span>
            <button class="copy-button" data-copy="${index}">复制</button>
          </div>
          <p class="comment-text">${escapeHtml(item.text)}</p>
          <div class="comment-meta">
            ${item.tags
              .map((tag) => `<span class="tag ${tag.includes("确认") ? "warning" : ""}">${escapeHtml(tag)}</span>`)
              .join("")}
          </div>
        </article>
      `
    )
    .join("") + `
      <article class="comment-card follow-card">
        <div class="comment-head">
          <span class="comment-type">回复后私信承接</span>
          <button class="copy-button" data-follow-up="1">复制</button>
        </div>
        <p class="comment-text">${escapeHtml(analysis.followUp)}</p>
        <div class="comment-meta">
          <span class="tag warning">等老师回复后再发</span>
          <span class="tag">明确知识星球</span>
        </div>
      </article>
    `;
}

function escapeHtml(value = "") {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function copyText(text, button) {
  await navigator.clipboard.writeText(text);
  const oldText = button.textContent;
  button.textContent = "已复制";
  setTimeout(() => {
    button.textContent = oldText;
  }, 1200);
}

async function loadConfig() {
  try {
    const response = await fetch(`./config.json?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return;
    const config = await response.json();
    appConfig = {
      ...appConfig,
      ...config,
      analyzeApis: Array.isArray(config.analyzeApis) && config.analyzeApis.length ? config.analyzeApis : appConfig.analyzeApis,
      readerProxies: Array.isArray(config.readerProxies) && config.readerProxies.length ? config.readerProxies : appConfig.readerProxies
    };
  } catch {
    appConfig = { ...appConfig };
  }
}

function timeoutSignal(timeoutMs) {
  const controller = new AbortController();
  window.setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
}

async function fetchWithTimeout(resource, options = {}) {
  const timeoutMs = options.timeoutMs || appConfig.requestTimeoutMs || 5500;
  const { timeoutMs: _timeoutMs, ...fetchOptions } = options;
  return fetch(resource, {
    ...fetchOptions,
    signal: timeoutSignal(timeoutMs)
  });
}

async function firstSuccessful(tasks) {
  const errors = [];
  return new Promise((resolve, reject) => {
    let pending = tasks.length;

    tasks.forEach((task) => {
      task()
        .then(resolve)
        .catch((error) => {
          errors.push(error);
          pending -= 1;
          if (pending === 0) reject(errors);
        });
    });
  });
}

function normalizeUrl(url) {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}

function readMeta(document, selectors) {
  for (const selector of selectors) {
    const value = document.querySelector(selector)?.getAttribute("content");
    if (value) return cleanText(value);
  }
  return "";
}

function parseHtml(html, url) {
  const document = new DOMParser().parseFromString(html, "text/html");
  document.querySelectorAll("script, style, noscript, svg, iframe, nav, footer, header").forEach((node) => node.remove());
  const title = cleanText(
    readMeta(document, ['meta[property="og:title"]', 'meta[name="twitter:title"]']) ||
      document.querySelector("title")?.textContent ||
      ""
  );
  const description = cleanText(
    readMeta(document, ['meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]'])
  );
  const author = cleanText(
    readMeta(document, ['meta[name="author"]', 'meta[property="article:author"]']) ||
      document.querySelector('[rel="author"]')?.textContent ||
      ""
  );
  const mainText = cleanText(
    document.querySelector("article")?.textContent ||
      document.querySelector("main")?.textContent ||
      document.body?.textContent ||
      ""
  ).slice(0, 1600);

  return {
    ok: true,
    url,
    page: {
      title,
      description,
      author,
      content: mainText
    }
  };
}

function buildProxyUrl(proxy, targetUrl) {
  if (proxy === "codetabs") {
    return `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`;
  }
  if (proxy === "allorigins") {
    return `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
  }
  return "";
}

async function analyzeUrlWithProxy(url, proxy) {
  const targetUrl = normalizeUrl(url);
  const proxyUrl = buildProxyUrl(proxy, targetUrl);
  if (!proxyUrl) throw new Error("备用读取通道未配置");
  const response = await fetchWithTimeout(proxyUrl);
  if (!response.ok) throw new Error(`${proxy} 读取失败：${response.status}`);
  const html = await response.text();
  const result = parseHtml(html, targetUrl);
  const hasContent = result.page.title || result.page.description || result.page.content.length > 40;
  if (!hasContent) throw new Error(`${proxy} 没有拿到可用内容`);
  return result;
}

async function analyzeUrl(url) {
  const tasks = [
    ...appConfig.analyzeApis.map((apiUrl) => async () => {
      const response = await fetchWithTimeout(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || `${apiUrl} 返回 ${response.status}`);
      }
      return data;
    }),
    ...appConfig.readerProxies.map((proxy) => async () => {
      const result = await analyzeUrlWithProxy(url, proxy);
      return {
        ...result,
        warning: "主读取接口暂时访问失败，已用备用方式读取内容"
      };
    })
  ];

  try {
    return await firstSuccessful(tasks);
  } catch (errors) {
    const messages = errors
      .map((error) => (error.name === "AbortError" ? "读取接口访问超时" : error.message || "读取失败"))
      .filter(Boolean);
    return {
      url,
      warning: `${messages.slice(0, 3).join("；")}。请补充老师内容摘要，留言会更准确。`,
      page: {
        title: "",
        description: "",
        author: "",
        content: ""
      }
    };
  }
}

generateButton.addEventListener("click", async () => {
  const url = cleanText(urlInput.value);
  const note = cleanText(noteInput.value);

  if (!url && !note) {
    statusPill.textContent = "缺少信息";
    pageCard.innerHTML = `<p class="error">请至少输入一个链接，或补充这条内容的关键信息。</p>`;
    return;
  }

  generateButton.disabled = true;
  generateButton.textContent = "正在生成...";
  statusPill.textContent = "分析中";

  let page = { title: "", description: "", author: "", content: "" };
  let finalUrl = url;
  let warning = "";

  try {
    if (url) {
      const result = await analyzeUrl(url);
      page = result.page || page;
      finalUrl = result.url || url;
      warning = result.warning || "";
      if (note) {
        page.content = cleanText(`${note} ${page.content || ""}`);
        page.description = page.description || note;
      }
    }

    if (!page.content && !page.description && note) {
      page.content = note;
    }

    const analysis = buildComments({
      page,
      note,
      goal: goalInput.value,
      tone: toneInput.value
    });
    renderPage(page, finalUrl, warning, analysis);
    renderComments(analysis);
    statusPill.textContent = warning ? "需补充" : "已生成";
  } catch (error) {
    pageCard.innerHTML = `<p class="error">${escapeHtml(error.message || "生成失败")}</p>`;
    statusPill.textContent = "失败";
  } finally {
    generateButton.disabled = false;
    generateButton.textContent = "生成 3 条留言";
  }
});

comments.addEventListener("click", (event) => {
  const followButton = event.target.closest("[data-follow-up]");
  if (followButton) {
    copyText(currentFollowUp, followButton);
    return;
  }

  const button = event.target.closest("[data-copy]");
  if (!button) return;
  const item = currentComments[Number(button.dataset.copy)];
  if (item) copyText(item.text, button);
});

copyAllButton.addEventListener("click", () => {
  const text = [
    ...currentComments.map((item, index) => `${index + 1}. ${item.text}`),
    "",
    `回复后私信承接：${currentFollowUp}`
  ].join("\n");
  copyText(text, copyAllButton);
});

function applyQueryPreset() {
  const params = new URLSearchParams(window.location.search);
  const presetUrl = params.get("url") || "";
  const presetNote = params.get("note") || "";
  const presetGoal = params.get("goal") || "";
  const presetTone = params.get("tone") || "";

  if (presetUrl) urlInput.value = presetUrl;
  if (presetNote) noteInput.value = presetNote;
  if ([...goalInput.options].some((option) => option.value === presetGoal)) {
    goalInput.value = presetGoal;
  }
  if ([...toneInput.options].some((option) => option.value === presetTone)) {
    toneInput.value = presetTone;
  }

  if (params.get("auto") === "1" && (presetUrl || presetNote)) {
    window.setTimeout(() => generateButton.click(), 150);
  }
}

loadConfig().finally(applyQueryPreset);
