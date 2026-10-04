/*
 * 咕咕云腾讯云 ECS 防火墙自动加白
 * Surge
 */

var API_BASE =
  "https://www.guguyun.com/cany_tencentecs/firewall/whitelist?token=";

function getTokens() {
  if (typeof $argument === "undefined" || $argument === null) {
    return [];
  }

  var arg = String($argument);

  if (arg.indexOf("tokens=") === 0) {
    arg = arg.slice(7);
  }

  try {
    arg = decodeURIComponent(arg);
  } catch (e) {}

  return arg
    .split(/[,|;、\s]+/)
    .map(function (item) {
      return item.trim();
    })
    .filter(function (item) {
      return item.indexOf("ctecsfw_") === 0;
    });
}

function request(token) {
  return new Promise(function (resolve) {
    $httpClient.get(
      {
        url: API_BASE + encodeURIComponent(token),
        timeout: 15,

        // 只强制当前 API 请求直连
        // 不影响 Surge 其他流量的代理策略
        policy: "DIRECT"
      },
      function (error, response, body) {
        if (error) {
          resolve({
            ok: false,
            message: String(error)
          });
          return;
        }

        var status =
          response && (response.status || response.statusCode);

        var ok =
          typeof status === "number" &&
          status >= 200 &&
          status < 300;

        var message =
          body && String(body).trim()
            ? String(body).trim()
            : "HTTP " + status;

        resolve({
          ok: ok,
          message: message
        });
      }
    );
  });
}

var tokens = getTokens();

if (tokens.length === 0) {
  $notification.post(
    "咕咕云防火墙加白",
    "未配置 Token",
    "请在模块参数中填写 ctecsfw_ 开头的 Token"
  );

  $done({
    title: "咕咕云防火墙加白 ❌",
    content: "未配置 Token"
  });
} else {
  Promise.all(
    tokens.map(function (token) {
      return request(token);
    })
  ).then(function (results) {
    var okCount = 0;

    var lines = results.map(function (result, index) {
      if (result.ok) {
        okCount++;
      }

      return (
        "#" +
        (index + 1) +
        " " +
        (result.ok ? "✅ " : "❌ ") +
        result.message
      );
    });

    $done({
      title:
        "咕咕云防火墙加白 " +
        okCount +
        "/" +
        results.length,
      content: lines.join("\n")
    });
  });
}
