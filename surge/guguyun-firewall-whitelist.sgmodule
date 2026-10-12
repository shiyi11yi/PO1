
#!name=咕咕云防火墙自动加白
#!desc=自动将当前网络出口添加至指定固定槽位，支持网络切换、定时检测和手动刷新
#!category=Firewall
#!author=Eleven
#!arguments=tokens:""
#!arguments-desc=tokens: 填写 ctecsfw_xxx@2，多个用英文逗号分隔

[Rule]
DOMAIN,www.guguyun.com,DIRECT

[Script]
guguyun-fw-cron = type=cron,cronexp="*/5 * * * *",script-path=https://raw.githubusercontent.com/shiyi11yi/PO1/main/scripts/guguyun-firewall-whitelist.js,timeout=60,argument="tokens={{{tokens}}}"
guguyun-fw-event = type=event,event-name=network-changed,script-path=https://raw.githubusercontent.com/shiyi11yi/PO1/main/scripts/guguyun-firewall-whitelist.js,timeout=60,argument="tokens={{{tokens}}}"
guguyun-fw-panel = type=generic,script-path=https://raw.githubusercontent.com/shiyi11yi/PO1/main/scripts/guguyun-firewall-whitelist.js,timeout=60,argument="tokens={{{tokens}}}"

[Panel]
guguyun-fw = script-name=guguyun-fw-panel,title=咕咕云防火墙加白,content=点击刷新,update-interval=300
