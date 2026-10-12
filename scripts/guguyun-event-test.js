console.log("咕咕云：网络变化事件已执行");

$notification.post(
  "咕咕云网络事件测试",
  "network-changed 已触发",
  "Surge 已执行事件脚本"
);

$done();
