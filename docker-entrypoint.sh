#!/bin/bash
# Generate SSH host keys if missing, start sshd as root, then exec into CMD
sudo ssh-keygen -A 2>/dev/null
sudo /usr/sbin/sshd -f /etc/ssh/sshd_config
exec "$@"
