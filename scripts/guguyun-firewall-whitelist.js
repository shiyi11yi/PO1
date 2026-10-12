
/*
 * 咕咕云腾讯云 ECS 防火墙自动加白
 * Surge iOS
 *
 * 功能：
 * 1. 网络变化自动触发
 * 2. 网络未就绪自动重试
 * 3. 官方固定槽位网段比对
 * 4. 网段不一致才更新
 * 5. 多 Token、多固定槽位
 * 6. 手动面板、定时任务、引擎启动
 */

const BASE = "https://www.guguyun.com/cany_tencentecs/firewall/whitelist";
const IP_URL = "http://ip.3322.net";

const RETRY_COUNT = 3;
const RETRY_DELAY = 2000;

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

// 读取模块参数
function getTokens() {
  if (typeof $argument === "undefined" || !$argument) {
    return [];
  }

  let raw = String($argument).replace(/^tokens=/, "");

  try {
    raw = decodeURIComponent(raw);
  } catch (_) {}

  return [...new Set(
    raw.split(/[,|;、\s]+/)
      .map(s => s.trim())
      .filter(s => /^ctecsfw_[A-Za-z0-9_-]+@[0-4]$/.test(s))
  )];
}

// 获取触发方式
function getTrigger() {
  if (typeof $event !== "undefined" && $event) {
    return $event.name || "event";
  }

  if (typeof $script !== "undefined" && $script) {
    if ($script.type === "cron") return "cron";
    if ($script.type === "generic") return "manual";
  }

  return "unknown";
}

// HTTP GET 强制直连
function httpGet(url) {
  return new Promise((resolve, reject) => {
    $httpClient.get({
      url,
      timeout: 10,
      policy: "DIRECT",
      headers: {
        "Cache-Control": "no-cache",
        "Pragma": "no-cache"
      }
    }, (error, response, body) => {
      if (error) {
        reject(new Error(String(error)));
        return;
      }

      const status = Number(
        response && (response.status || response.statusCode)
      );

      if (status < 200 || status >= 300) {
        reject(new Error("HTTP " + status));
        return;
      }

      resolve(String(body || "").trim());
    });
  });
}

// API 响应校验
async function apiGet(url) {
  const body = await httpGet(url);

  let data;

  try {
    data = JSON.parse(body);
  } catch (_) {
    throw new Error("接口返回的数据不是有效 JSON");
  }

  if (Number(data.status) !== 200) {
    throw new Error(data.msg || "API 请求失败");
  }

  return data;
}

// 解析公网 IPv4
function parseIPv4(ip) {
  const parts = ip.trim().split(".");

  if (
    parts.length !== 4 ||
    !parts.every(p =>
      /^\d{1,3}$/.test(p) &&
      Number(p) >= 0 &&
      Number(p) <= 255
    )
  ) {
    throw new Error("无效的公网 IPv4：" + ip);
  }

  return {
    ip,
    cidr: parts.slice(0, 3).join(".") + ".0/24"
  };
}

// 获取公网 IP，失败后重试
async function getPublicIP() {
  let lastError;

  for (let i = 0; i < RETRY_COUNT; i++) {
    try {
      const ip = await httpGet(IP_URL);
      return parseIPv4(ip);
    } catch (e) {
      lastError = e;

      if (i < RETRY_COUNT - 1) {
        await sleep(RETRY_DELAY);
      }
    }
  }

  throw lastError;
}

// 查询与更新指定固定槽位
async function checkToken(token, cidr) {
  const index = token.lastIndexOf("@");
  const baseToken = token.slice(0, index);
  const slot = Number(token.slice(index + 1));

  // 获取官方固定槽位
  const query = await apiGet(
    BASE + "/query?token=" +
    encodeURIComponent(baseToken)
  );

  const slots = query.data && query.data.fixed_slots;

  if (!Array.isArray(slots)) {
    throw new Error("无法获取官方固定槽位");
  }

  const item = slots.find(
    s => Number(s.slot) === slot
  );

  if (!item) {
    throw new Error("固定槽位 " + slot + " 不存在");
  }

  const remote = item.cidr || "";

  // 网段一致，不更新
  if (remote === cidr) {
    return {
      ok: true,
      updated: false,
      slot,
      message: "槽位 " + slot + " 无变化：" + cidr
    };
  }

  // 网段变化或为空，执行更新
  const result = await apiGet(
    BASE + "?token=" + encodeURIComponent(token)
  );

  const data = result.data || {};
  const updated = data.cidr || "";

  // 校验实际写入的槽位与网段
  if (Number(data.slot) !== slot) {
    throw new Error(
      "固定槽位不一致：预期 " + slot +
      "，实际 " + data.slot
    );
  }

  if (updated !== cidr) {
    throw new Error(
      "出口网段不一致：本地 " + cidr +
      "，接口 " + updated
    );
  }

  return {
    ok: true,
    updated: true,
    slot,
    message: "槽位 " + slot + " 已更新：" +
      (remote || "空") + " → " + cidr
  };
}

// 主流程
async function main() {
  const trigger = getTrigger();
  const tokens = getTokens();

  const lines = [];
  let updateCount = 0;
  let successCount = 0;

  try {
    if (!tokens.length) {
      throw new Error(
        "未配置有效 Token，请使用 ctecsfw_xxx@槽位"
      );
    }

    // 网络切换事件通知
    if (trigger === "network-changed") {
      console.log("咕咕云：检测到网络变化事件");

      $notification.post(
        "咕咕云网络切换检测",
        "Surge 已检测到网络变化",
        "正在检查新的公网 IP"
      );

      // 等待新网络就绪
      await sleep(1500);
    }

    // 获取当前公网 IP
    const network = await getPublicIP();

    console.log(
      "咕咕云：触发方式=" + trigger +
      "，公网 IP=" + network.ip
    );

    // 逐个检查 Token
    for (const token of tokens) {
      const slot = token.slice(token.lastIndexOf("@") + 1);

      try {
        const result = await checkToken(
          token,
          network.cidr
        );

        successCount++;

        if (result.updated) {
          updateCount++;

          $notification.post(
            "咕咕云白名单更新成功",
            "固定槽位 " + result.slot,
            result.message
          );
        }

        lines.push("✅ " + result.message);
        console.log(result.message);

      } catch (e) {
        const msg = "槽位 " + slot + " 更新失败：" + e.message;

        lines.push("❌ " + msg);
        console.log("咕咕云：" + msg);

        $notification.post(
          "咕咕云白名单更新失败",
          "固定槽位 " + slot,
          e.message
        );
      }
    }

    const content =
      "公网 IP：" + network.ip +
      "\n触发方式：" + trigger +
      "\n" + lines.join("\n");

    console.log(
      "咕咕云：成功 " +
      successCount + "/" + tokens.length +
      "，更新 " + updateCount
    );

    $done({
      title: "咕咕云防火墙加白 " +
        successCount + "/" + tokens.length,
      content
    });

  } catch (e) {
    const msg = "检测失败：" + e.message;

    console.log("咕咕云：" + msg);

    $notification.post(
      "咕咕云防火墙加白失败",
      "网络或配置异常",
      e.message
    );

    $done({
      title: "咕咕云防火墙加白 ❌",
      content: msg
    });
  }
}

main();
