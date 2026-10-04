/*
 * 咕咕云腾讯云 ECS 防火墙自动加白
 * Surge
 *
 * token 通过 Surge 模块参数传入：
 * argument="tokens={{{tokens}}}"
 *
 * 支持：
 * ctecsfw_xxx@2
 * ctecsfw_xxx@2,ctecsfw_yyy@1
 */

var API_BASE =
  "https://www.guguyun.com/cany_tencentecs/firewall/whitelist?token=";

function getTokens() {
  if (typeof $argument === "undefined" || $argument === null) {
    return [];
  }

  var arg = String($argument);

  // Surge 传入格式：tokens=xxx
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
        timeout: 15
      },
      function (error, response, body) {
        if (error) {
          resolve({
            token: token,
            ok: false,
            message: String(error)
          });
          return;
        }

        var status =
          response && (response.status || response.statusCode);

        var ok = status >= 200 && status < 300;

        resolve({
          token: token,
          ok: ok,
          message:
            body && String(body).trim()
              ? String(body).trim()
              : "HTTP " + status
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
    content: "未配置 Token",
    icon: "exclamationmark.shield",
    "icon-color": "#FF3B30"
  });
} else {
  Promise.all(
    tokens.map(function (token) {
      return request(token);
    })
  ).then(function (results) {
    var okCount = 0;

    var lines = results.map(function (result, index) {
      if (result.ok) okCount++;

      return (
        "#" +
        (index + 1) +
        " " +
        (result.ok ? "✅ " : "❌ ") +
        result.message
      );
    });

    var allOk = okCount === results.length;

    $done({
      title:
        "咕咕云防火墙加白 " +
        okCount +
        "/" +
        results.length,
      content: lines.join("\n"),
      icon: allOk
        ? "checkmark.shield"
        : "exclamationmark.shield",
      "icon-color": allOk
        ? "#34C759"
        : "#FF3B30"
    });
  });
}
