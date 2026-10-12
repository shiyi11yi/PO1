
/*
 * 咕咕云腾讯云 ECS 防火墙自动加白
 * Surge iOS - 网络切换诊断版
 *
 * 官方槽位查询 + /24 网段比较
 * 支持多 Token、多固定槽位
 * Wi-Fi / 蜂窝网络切换自动检测
 */

const BASE = "https://www.guguyun.com/cany_tencentecs/firewall/whitelist";
const IP_URL = "http://ip.3322.net";

const RETRY_COUNT = 3;
const RETRY_DELAY = 2000;
const DEBUG = true;

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

// 读取模块参数
function getConfig() {
  const raw = typeof $argument === "undefined"
    ? "" : String($argument);

  const source = (
    raw.match(/(?:^|&)source=([^&]*)/) || []
  )[1] || "unknown";

  let tokenText = (
    raw.match(/(?:^|&)tokens=(.*)$/) || []
  )[1] || "";

  try {
    tokenText = decodeURIComponent(tokenText);
  } catch (_) {}

  const tokens = [...new Set(
    tokenText.split(/[,|;、\s]+/)
      .map(s => s.trim())
      .filter(s => /^ctecsfw_[A-Za-z0-9_-]+@[0-4]$/.test(s))
  )];

  return { source, tokens };
}

// 日志
function log(message) {
  console.log("[咕咕云] " + message);
}

// 通知
function notify(title, subtitle, body) {
  $notification.post(title, subtitle, body);
}

// HTTP GET，强制直连
function httpGet(url) {
  return new Promise((resolve, reject) => {
    $httpClient.get({
      url,
      policy: "DIRECT",
      timeout: 10,
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
        response &&
        (response.status || response.statusCode)
      );

      if (!Number.isFinite(status) ||
          status < 200 || status >= 300) {
        reject(new Error("HTTP " + status));
        return;
      }

      resolve(String(body || "").trim());
    });
  });
}

// 咕咕云 API
async function apiGet(url) {
  const body = await httpGet(url);

  let result;

  try {
    result = JSON.parse(body);
  } catch (_) {
    throw new Error("API 返回无效 JSON");
  }

  if (Number(result.status) !== 200) {
    throw new Error(result.msg || "API 请求失败");
  }

  return result;
}

// IPv4 转换为 /24 网段
function parseIPv4(value) {
  const ip = String(value).trim();
  const parts = ip.split(".");

  if (
    parts.length !== 4 ||
    !parts.every(p =>
      /^\d{1,3}$/.test(p) &&
      Number(p) >= 0 &&
      Number(p) <= 255
    )
  ) {
    throw new Error("无效公网 IPv4：" + ip);
  }

  return {
    ip,
    cidr: parts.slice(0, 3).join(".") + ".0/24"
  };
}

// 获取当前公网 IP
async function getPublicIP() {
  let lastError;

  for (let i = 0; i < RETRY_COUNT; i++) {
    try {
      const value = await httpGet(IP_URL);
      return parseIPv4(value);
    } catch (e) {
      lastError = e;
      log("公网 IP 检测失败，第 " + (i + 1) + " 次：" + e.message);

      if (i < RETRY_COUNT - 1) {
        await sleep(RETRY_DELAY);
      }
    }
  }

  throw lastError;
}

// 网络切换时确认新出口
async function detectNetwork(source) {
  if (source !== "network") {
    return await getPublicIP();
  }

  // 等待 Wi-Fi / 蜂窝网络建立连接
  await sleep(1500);

  const first = await getPublicIP();
  log("首次检测公网 IP：" + first.ip);

  // 即使首次请求成功，也再次确认出口
  await sleep(2500);

  try {
    const second = await getPublicIP();
    log("二次检测公网 IP：" + second.ip);

    return second;
  } catch (e) {
    log("二次检测失败：" + e.message);
    throw e;
  }
}

// 查询并更新固定槽位
async function checkToken(token, cidr) {
  const index = token.lastIndexOf("@");
  const baseToken = token.slice(0, index);
  const slot = Number(token.slice(index + 1));

  // 查询官方固定槽位
  const query = await apiGet(
    BASE + "/query?token=" +
    encodeURIComponent(baseToken)
  );

  const slots = query.data && query.data.fixed_slots;

  if (!Array.isArray(slots)) {
    throw new Error("官方固定槽位数据无效");
  }

  const item = slots.find(
    s => Number(s.slot) === slot
  );

  if (!item) {
    throw new Error("固定槽位 " + slot + " 不存在");
  }

  const remote = item.cidr || "";

  log(
    "槽位 " + slot +
    "，官方：" + (remote || "空") +
    "，当前：" + cidr
  );

  // 网段一致，无需更新
  if (remote === cidr) {
    return {
      slot,
      updated: false,
      message: "槽位 " + slot + " 无变化：" + cidr
    };
  }

  // 网段变化，更新指定固定槽位
  const result = await apiGet(
    BASE + "?token=" + encodeURIComponent(token)
  );

  const data = result.data || {};
  const actualSlot = Number(data.slot);
  const actualCidr = data.cidr || "";

  // 验证接口更新结果
  if (actualSlot !== slot) {
    throw new Error(
      "槽位不一致：预期 " + slot +
      "，实际 " + data.slot
    );
  }

  if (actualCidr !== cidr) {
    throw new Error(
      "出口不一致：本地 " + cidr +
      "，接口 " + actualCidr
    );
  }

  return {
    slot,
    updated: true,
    message: "槽位 " + slot +
      " 已更新：" +
      (remote || "空") + " → " + cidr
  };
}

// 主程序
async function main() {
  const config = getConfig();
  const source = config.source;
  const tokens = config.tokens;

  const lines = [];
  let success = 0;
  let updated = 0;

  const isPanel = source === "panel";

  // 脚本开始执行时立即记录
  log("脚本已启动，触发方式：" + source);
  log("有效 Token 数量：" + tokens.length);

  // 调试模式：所有入口执行时都通知
  if (DEBUG) {
    notify(
      "咕咕云脚本已执行",
      "触发方式：" + source,
      "正在检查公网 IP 和官方固定槽位"
    );
  }

  try {
    if (!tokens.length) {
      throw new Error(
        "没有有效 Token，请填写 ctecsfw_xxx@槽位"
      );
    }

    // 检测公网 IP
    const network = await detectNetwork(source);

    log("最终公网 IP：" + network.ip);
    log("本地目标网段：" + network.cidr);

    // 查询所有指定固定槽位
    for (const token of tokens) {
      const slot = token.slice(
        token.lastIndexOf("@") + 1
      );

      try {
        const result = await checkToken(
          token,
          network.cidr
        );

        success++;

        if (result.updated) {
          updated++;

          notify(
            "咕咕云白名单更新成功",
            "固定槽位 " + result.slot,
            result.message
          );
        }

        lines.push("✅ " + result.message);
        log(result.message);

      } catch (e) {
        const message =
          "槽位 " + slot + " 失败：" + e.message;

        lines.push("❌ " + message);
        log(message);

        notify(
          "咕咕云白名单更新失败",
          "固定槽位 " + slot,
          e.message
        );
      }
    }

    const content =
      "公网 IP：" + network.ip +
      "\n触发方式：" + source +
      "\n" + lines.join("\n");

    log(
      "执行完成，成功 " + success +
      "/" + tokens.length +
      "，实际更新 " + updated
    );

    // 只有面板需要返回显示内容
    if (isPanel) {
      $done({
        title: "咕咕云防火墙加白 " +
          success + "/" + tokens.length,
        content
      });
    } else {
      $done();
    }

  } catch (e) {
    log("检测失败：" + e.message);

    notify(
      "咕咕云防火墙加白失败",
      "触发方式：" + source,
      e.message
    );

    if (isPanel) {
      $done({
        title: "咕咕云防火墙加白 ❌",
        content: "检测失败：" + e.message
      });
    } else {
      $done();
    }
  }
}

main();
