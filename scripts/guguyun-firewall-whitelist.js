
/*
 * 咕咕云防火墙自动加白 - Surge iOS
 *
 * 支持：
 * 1. 网络变化自动上报
 * 2. 每 5 分钟定时上报
 * 3. 面板手动上报
 * 4. 多 Token / 固定槽位
 * 5. 每次执行通知（调试）
 */

const API = "https://www.guguyun.com/cany_tencentecs/firewall/whitelist";

// 调试开关：true = 每次执行均通知
const DEBUG = true;

// 读取配置
function getConfig() {
  const raw = typeof $argument === "undefined"
    ? "" : String($argument);

  const source = (
    raw.match(/(?:^|&)source=([^&]*)/) || []
  )[1] || "unknown";

  const value = (
    raw.match(/(?:^|&)tokens=(.*)$/) || []
  )[1] || "";

  const tokens = [...new Set(
    value.split(/[,;|、\s]+/)
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
function notify(title, subtitle, content) {
  $notification.post(title, subtitle, content);
}

// 调用加白接口
function request(token) {
  return new Promise(resolve => {
    $httpClient.get({
      url: API + "?token=" + encodeURIComponent(token),
      policy: "DIRECT",
      timeout: 15
    }, (error, response, body) => {

      if (error) {
        resolve({
          ok: false,
          error: String(error)
        });
        return;
      }

      const status = Number(
        response && (response.status || response.statusCode)
      );

      if (!Number.isFinite(status) ||
          status < 200 || status >= 300) {
        resolve({
          ok: false,
          error: "HTTP " + status
        });
        return;
      }

      try {
        const result = JSON.parse(body);

        if (Number(result.status) !== 200) {
          resolve({
            ok: false,
            error: result.msg || "接口更新失败"
          });
          return;
        }

        const data = result.data || {};

        if (!data.cidr || data.slot === undefined) {
          resolve({
            ok: false,
            error: "接口返回数据不完整"
          });
          return;
        }

        resolve({
          ok: true,
          cidr: data.cidr,
          slot: Number(data.slot)
        });

      } catch (e) {
        resolve({
          ok: false,
          error: "接口返回无效 JSON"
        });
      }
    });
  });
}

// 主程序
async function main() {
  const { source, tokens } = getConfig();
  const isPanel = source === "panel";

  const names = {
    cron: "定时上报",
    network: "网络切换",
    panel: "手动/面板刷新"
  };

  const trigger = names[source] || source;

  log("脚本已执行，触发方式：" + trigger);

  // 每次运行立即通知，确认是否真正触发
  if (DEBUG) {
    notify(
      "咕咕云脚本已执行",
      trigger,
      "开始请求咕咕云加白接口"
    );
  }

  try {
    if (!tokens.length) {
      throw new Error("未配置有效 Token");
    }

    const results = [];

    // 逐个上报指定槽位
    for (const token of tokens) {
      const slot = Number(token.split("@").pop());

      const response = await request(token);

      if (!response.ok) {
        results.push({
          ok: false,
          message: "槽位 " + slot + " 失败：" + response.error
        });
        continue;
      }

      if (response.slot !== slot) {
        results.push({
          ok: false,
          message: "槽位 " + slot + " 返回槽位不一致"
        });
        continue;
      }

      results.push({
        ok: true,
        message: "槽位 " + slot + " 成功：" + response.cidr
      });
    }

    const success = results.filter(r => r.ok).length;
    const failed = results.length - success;

    const content = results.map(r => r.message).join("\n");

    log("触发方式：" + trigger);
    log("上报结果：" + success + "/" + results.length);
    log(content);

    // 调试期间：每次完成都通知
    // 关闭调试后：仅失败时通知
    if (DEBUG || failed > 0) {
      notify(
        "咕咕云防火墙加白",
        trigger + " | 成功 " + success + "/" + results.length,
        content
      );
    }

    if (isPanel) {
      $done({
        title: "咕咕云加白 " + success + "/" + results.length,
        content: "触发方式：" + trigger + "\n" + content
      });
    } else {
      $done();
    }

  } catch (e) {
    log("执行失败：" + e.message);

    notify(
      "咕咕云防火墙加白失败",
      trigger,
      e.message
    );

    if (isPanel) {
      $done({
        title: "咕咕云加白失败",
        content: e.message
      });
    } else {
      $done();
    }
  }
}

main().catch(e => {
  log("脚本异常：" + e.message);
  notify("咕咕云脚本异常", "执行失败", e.message);
  $done();
});
