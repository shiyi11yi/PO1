
const BASE = "https://www.guguyun.com/cany_tencentecs/firewall/whitelist";
const IP_URL = "http://ip.3322.net";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function getTokens() {
  const raw = typeof $argument === "undefined"
    ? "" : String($argument).replace(/^tokens=/, "");

  return [...new Set(raw.split(/[,;|\s、]+/)
    .map(x => x.trim())
    .filter(x => /^ctecsfw_[A-Za-z0-9_-]+@[0-4]$/.test(x)))];
}

function get(url) {
  return new Promise((resolve, reject) => {
    $httpClient.get({
      url,
      policy: "DIRECT",
      timeout: 10,
      headers: { "Cache-Control": "no-cache" }
    }, (err, res, body) => {
      if (err) return reject(new Error(String(err)));
      const code = Number(res && (res.status || res.statusCode));
      if (code < 200 || code >= 300)
        return reject(new Error("HTTP " + code));
      resolve(String(body || "").trim());
    });
  });
}

async function api(url) {
  const data = JSON.parse(await get(url));
  if (Number(data.status) !== 200)
    throw new Error(data.msg || "API 请求失败");
  return data;
}

async function getPublicCidr() {
  const ip = await get(IP_URL);
  const parts = ip.split(".");
  if (parts.length !== 4 || !parts.every(x =>
    /^\d{1,3}$/.test(x) && Number(x) <= 255))
    throw new Error("无效公网 IP: " + ip);

  return {
    ip,
    cidr: parts.slice(0, 3).join(".") + ".0/24"
  };
}

async function check(token, cidr) {
  const pos = token.lastIndexOf("@");
  const slot = Number(token.slice(pos + 1));
  const baseToken = token.slice(0, pos);

  const query = await api(
    BASE + "/query?token=" + encodeURIComponent(baseToken)
  );

  const slots = query.data && query.data.fixed_slots;
  if (!Array.isArray(slots))
    throw new Error("无法读取固定槽位");

  const item = slots.find(s => Number(s.slot) === slot);
  if (!item) throw new Error("槽位 " + slot + " 不存在");

  const oldCidr = item.cidr || "";

  if (oldCidr === cidr)
    return "槽位 " + slot + "：已同步 " + cidr;

  const result = await api(
    BASE + "?token=" + encodeURIComponent(token)
  );

  if (!result.data ||
      Number(result.data.slot) !== slot ||
      result.data.cidr !== cidr) {
    throw new Error(
      "槽位 " + slot + " 更新结果与本地出口不一致"
    );
  }

  $notification.post(
    "咕咕云白名单更新成功",
    "固定槽位 " + slot,
    (oldCidr || "空") + " → " + cidr
  );

  return "槽位 " + slot + "：更新成功 " + cidr;
}

async function main() {
  const tokens = getTokens();
  const logs = [];

  try {
    if (!tokens.length) throw new Error("未配置有效 Token");

    // 网络切换事件：给新网络短暂建立连接的时间
    if (typeof $script !== "undefined" &&
        $script.type === "event") {
      await sleep(1500);
    }

    // 网络未就绪时重试，最多三次
    let network;
    for (let i = 0; i < 3; i++) {
      try {
        network = await getPublicCidr();
        break;
      } catch (e) {
        if (i === 2) throw e;
        await sleep(2000);
      }
    }

    for (const token of tokens) {
      try {
        logs.push(await check(token, network.cidr));
      } catch (e) {
        logs.push("失败：" + e.message);
        console.log("咕咕云：" + e.message);
      }
    }

    console.log("咕咕云 IP：" + network.ip);
    console.log(logs.join("\n"));

    $done({
      title: "咕咕云防火墙加白",
      content: "公网 IP：" + network.ip +
        "\n" + logs.join("\n")
    });

  } catch (e) {
    console.log("咕咕云：" + e.message);
    $done({
      title: "咕咕云防火墙加白",
      content: "检测失败：" + e.message
    });
  }
}

main();
