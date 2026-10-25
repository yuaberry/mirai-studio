#!/bin/bash
# Mirai Studio — deb after-remove: electron-builder default + cache refresh.

if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove 'mirai-studio' '/opt/Mirai Studio/mirai-studio'
else
    rm -f '/usr/bin/mirai-studio'
fi

if hash gtk-update-icon-cache 2>/dev/null; then
    gtk-update-icon-cache -f -q /usr/share/icons/hicolor || true
fi
