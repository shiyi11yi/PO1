
/*
 * 咕咕云腾讯云 ECS 防火墙自动加白
 * Surge - 官方固定槽位比对版
 */

const BASE = "https://www.guguyun.com/cany_tencentecs/firewall/whitelist";
const IP_URL = "http://ip.3322.net";

function getTokens() {
  if (typeof $argument === "undefined" || !$argument) return [];

  let arg = String($argument).replace(/^tokens=/, "");

  try {
    arg = decodeURIComponent(arg);
  } catch (_) {}

  return [...new Set(
    arg.split(/[,|;、\s]+/)
      .map(s => s.trim())
      .filter(s => /^ctecsfw_.+@[0-4]$/.test(s))
  )];
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    $httpClient.get({
      url: url,
      timeout: 15,
      policy: "DIRECT"
    }, (error, response, body) => {
      if (error) {
        reject(new Error(String(error)));
        return;
      }

      const status = response &&
        (response.status || response.statusCode);

      if (status < 200 || status >= 300) {
        reject(new Error("HTTP " + status));
        return;
      }

      resolve(String(body || "").trim());
    });
  });
}

async function apiGet(url) {
  const body = await httpGet(url);
  let data;

  try {
    data = JSON.parse(body);
  } catch (_) {
    throw new Error("接口返回非 JSON 数据");
  }

  if (Number(data.status) !== 200) {
    throw new Error(data.msg || "接口请求失败");
  }

  return data;
}

function getCidr(ip) {
  const parts = ip.trim().split(".");

  if (parts.length !== 4 ||
      !parts.every(p =>
        /^\d{1,3}$/.test(p) &&
        Number(p) >= 0 &&
        Number(p) <= 255
      )) {
    throw new Error("公网 IPv4 无效: " + ip);
  }

  return parts.slice(0, 3).join(".") + ".0/24";
}

async function checkToken(token, cidr) {
  const at = token.lastIndexOf("@");
  const baseToken = token.slice(0, at);
  const slot = Number(token.slice(at + 1));

  try {
    // 查询官方白名单
    const query = await apiGet(
      BASE + "/query?token=" + encodeURIComponent(baseToken)
    );

    const slots = query.data && query.data.fixed_slots;

    if (!Array.isArray(slots)) {
      throw new Error("固定槽位数据无效");
    }

    const entry = slots.find(
      item => Number(item.slot) === slot
    );

    if (!entry) {
      throw new Error("未找到固定槽位 " + slot);
    }

    const remote = entry.cidr || "";

    // 网段一致，无需更新
    if (remote === cidr) {
      return {
        ok: true,
        message: "槽位 " + slot + " ✅ 无变化: " + cidr
      };
    }

    // 不一致时更新指定固定槽位
    const update = await apiGet(
      BASE + "?token=" + encodeURIComponent(token)
    );

    const updatedCidr = update.data && update.data.cidr;

    if (updatedCidr !== cidr) {
      throw new Error(
        "出口不一致: 本地 " + cidr +
        "，接口 " + (updatedCidr || "未知")
      );
    }

    if (Number(update.data.slot) !== slot) {
      throw new Error("接口返回的槽位不一致");
    }

    return {
      ok: true,
      message: "槽位 " + slot + " ✅ 已更新: " +
        (remote || "空") + " → " + cidr
    };

  } catch (e) {
    return {
      ok: false,
      message: "槽位 " + slot + " ❌ " + e.message
    };
  }
}

async function main() {
  const tokens = getTokens();

  if (!tokens.length) {
    $done({
      title: "咕咕云防火墙加白 ❌",
      content: "未配置有效 Token，请填写 ctecsfw_xxx@槽位"
    });
    return;
  }

  try {
    // 强制直连获取当前公网 IP
    const ip = await httpGet(IP_URL);
    const cidr = getCidr(ip);

    const results = await Promise.all(
      tokens.map(token => checkToken(token, cidr))
    );

    const success = results.filter(r => r.ok).length;

    $done({
      title: "咕咕云防火墙加白 " +
        success + "/" + results.length,
      content: "当前公网 IP: " + ip + "\n" +
        results.map(r => r.message).join("\n")
    });

  } catch (e) {
    $done({
      title: "咕咕云防火墙加白 ❌",
      content: "检测失败: " + e.message
    });
  }
}

main();
