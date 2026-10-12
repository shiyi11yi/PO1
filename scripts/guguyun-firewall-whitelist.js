
/*
 * 咕咕云防火墙自动加白 - Surge
 * 参考 PO0 方式：每次触发直接调用加白接口
 */

const API = "https://www.guguyun.com/cany_tencentecs/firewall/whitelist";
const STATE_KEY = "guguyun_fw_";

function getTokens() {
  const raw = typeof $argument === "undefined"
    ? "" : String($argument).replace(/^tokens=/, "");

  return [...new Set(
    raw.split(/[,;|、\s]+/)
      .map(s => s.trim())
      .filter(s => /^ctecsfw_[A-Za-z0-9_-]+@[0-4]$/.test(s))
  )];
}

function request(token) {
  return new Promise(resolve => {
    $httpClient.get({
      url: API + "?token=" + encodeURIComponent(token),
      policy: "DIRECT",
      timeout: 15
    }, (error, response, body) => {
      if (error) {
        resolve({ error: String(error) });
        return;
      }

      try {
        const data = JSON.parse(body);

        if (Number(data.status) !== 200) {
          resolve({ error: data.msg || "API 请求失败" });
          return;
        }

        if (!data.data ||
            !data.data.cidr ||
            data.data.slot === undefined) {
          resolve({ error: "接口返回数据不完整" });
          return;
        }

        resolve({
          cidr: data.data.cidr,
          slot: Number(data.data.slot)
        });
      } catch (e) {
        resolve({ error: "接口响应异常" });
      }
    });
  });
}

async function main() {
  const tokens = getTokens();

  if (!tokens.length) {
    $notification.post(
      "咕咕云防火墙加白",
      "配置错误",
      "请填写有效 Token，例如 ctecsfw_xxx@2"
    );
    $done();
    return;
  }

  const results = await Promise.all(
    tokens.map(async token => {
      const slot = Number(token.split("@").pop());
      const result = await request(token);

      if (result.error) {
        return {
          ok: false,
          message: "槽位 " + slot + " ❌ " + result.error
        };
      }

      if (result.slot !== slot) {
        return {
          ok: false,
          message: "槽位 " + slot + " ❌ 返回槽位不一致"
        };
      }

      const key = STATE_KEY + slot;
      const last = $persistentStore.read(key);
      const changed = last !== result.cidr;

      if (changed) {
        $persistentStore.write(result.cidr, key);
      }

      return {
        ok: true,
        changed,
        message: "槽位 " + slot + " ✅ " + result.cidr
      };
    })
  );

  const success = results.filter(r => r.ok).length;
  const changed = results.some(r => r.changed);
  const failed = results.some(r => !r.ok);

  const title = "咕咕云加白 " + success + "/" + results.length;
  const content = results.map(r => r.message).join("\n");

  if (changed || failed) {
    $notification.post(
      "咕咕云防火墙加白",
      title,
      content
    );
  }

  console.log(title + "\n" + content);

  $done({
    title,
    content
  });
}

main().catch(e => {
  console.log("咕咕云脚本异常：" + e.message);
  $notification.post(
    "咕咕云防火墙加白",
    "脚本异常",
    e.message
  );
  $done();
});
