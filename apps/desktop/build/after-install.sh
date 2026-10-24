#!/bin/bash
# Mirai Studio — deb after-install: the electron-builder default steps
# (kept VERBATIM — losing the chrome-sandbox chmod breaks the app) PLUS the
# icon-cache refresh Linux Mint/Cinnamon needs to actually show the icon.

if type update-alternatives 2>/dev/null >&1; then
    # Remove previous link if it doesn't use update-alternatives
    if [ -L '/usr/bin/mirai-studio' -a -e '/usr/bin/mirai-studio' -a "`readlink '/usr/bin/mirai-studio'`" != '/etc/alternatives/mirai-studio' ]; then
        rm -f '/usr/bin/mirai-studio'
    fi
    update-alternatives --install '/usr/bin/mirai-studio' 'mirai-studio' '/opt/Mirai Studio/mirai-studio' 100 || ln -sf '/opt/Mirai Studio/mirai-studio' '/usr/bin/mirai-studio'
else
    ln -sf '/opt/Mirai Studio/mirai-studio' '/usr/bin/mirai-studio'
fi

# SUID chrome-sandbox for Electron 5+
chmod 4755 '/opt/Mirai Studio/chrome-sandbox' || true

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi

# THE FIX (v0.20): without this, Cinnamon/Mint keeps a stale hicolor cache
# and the app shows up with NO icon in the menu until a manual cache refresh.
if hash gtk-update-icon-cache 2>/dev/null; then
    gtk-update-icon-cache -f -q /usr/share/icons/hicolor || true
elif hash gtk-update-icon-cache-3.0 2>/dev/null; then
    gtk-update-icon-cache-3.0 -f -q /usr/share/icons/hicolor || true
fi
