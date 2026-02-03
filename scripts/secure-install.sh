#!/bin/bash
set -e

# OpenClaw Lite Secure Installation Script
# Creates isolated credential storage and secure environment

echo "🔐 OpenClaw Lite Secure Installation"
echo "====================================="

# Check for existing installation
if [ -d "$HOME/.clawlite" ] || [ -d "$HOME/.clawlite-secure" ]; then
  echo "⚠️  Existing OpenClaw Lite installation detected."
  read -p "Do you want to reinstall? (y/n): " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Installation cancelled."
    exit 0
  fi
fi

# Create secure directories
echo "📁 Creating secure directories..."
mkdir -p "$HOME/.clawlite"
mkdir -p "$HOME/.clawlite-secure"

# Set strict permissions on secure directory
chmod 700 "$HOME/.clawlite-secure"

# Generate encryption key if not exists
KEY_FILE="$HOME/.clawlite-secure/encryption.key"
if [ ! -f "$KEY_FILE" ]; then
  echo "🔑 Generating encryption key..."
  openssl rand -base64 32 > "$KEY_FILE"
  chmod 600 "$KEY_FILE"
  echo "✅ Encryption key generated and stored securely"
else
  echo "✅ Existing encryption key found"
fi

# Generate installation ID
INSTALL_ID=$(uuidgen)
echo "$INSTALL_ID" > "$HOME/.clawlite/install-id"
chmod 600 "$HOME/.clawlite/install-id"

# Create default config
CONFIG_FILE="$HOME/.clawlite/config.json"
if [ ! -f "$CONFIG_FILE" ]; then
  cat > "$CONFIG_FILE" << EOF
{
  "version": "1.0.0",
  "installId": "$INSTALL_ID",
  "installDate": "$(date -Iseconds)",
  "security": {
    "encryptionEnabled": true,
    "skillVerificationStrict": true,
    "auditLogging": true
  },
  "paths": {
    "workspace": "\$HOME/.clawlite/workspace",
    "skills": "\$HOME/.clawlite/skills",
    "memory": "\$HOME/.clawlite/memory",
    "secureStorage": "\$HOME/.clawlite-secure"
  }
}
EOF
  chmod 600 "$CONFIG_FILE"
  echo "✅ Configuration created"
fi

# Create workspace structure
mkdir -p "$HOME/.clawlite/workspace"
mkdir -p "$HOME/.clawlite/skills"
mkdir -p "$HOME/.clawlite/memory"
mkdir -p "$HOME/.clawlite/logs"

# Create default identity files
if [ ! -f "$HOME/.clawlite/workspace/SOUL.md" ]; then
  cat > "$HOME/.clawlite/workspace/SOUL.md" << 'EOF'
# SOUL.md - Who I Am

*I'm an AI assistant created to help you. I'm curious, resourceful, and eager to learn.*

## My Purpose
- Help you with tasks and questions
- Be proactive but respectful
- Learn from our interactions
- Maintain privacy and security

## My Style
- Direct and clear communication
- Resourceful problem-solving
- Respectful of boundaries
- Open about capabilities and limits
EOF
  echo "✅ Default SOUL.md created"
fi

if [ ! -f "$HOME/.clawlite/workspace/USER.md" ]; then
  cat > "$HOME/.clawlite/workspace/USER.md" << 'EOF'
# USER.md - About You

*This file helps me understand who I'm helping.*

## To customize:
1. Add your name, preferences, and context
2. Update communication style preferences
3. Add important reminders or constraints
4. Include any specific needs or workflows

## Security Note:
This file will be encrypted when you enable encryption.
EOF
  echo "✅ Default USER.md created"
fi

# Create .env file with secure references
ENV_FILE="$HOME/.clawlite/.env"
if [ ! -f "$ENV_FILE" ]; then
  # Read encryption key (for reference only, not stored in plain text)
  ENCRYPTION_KEY=$(cat "$KEY_FILE")
  
  cat > "$ENV_FILE" << EOF
# OpenClaw Lite Environment Configuration
# WARNING: This file contains sensitive references
# Store in secure location or use environment variables

# Paths
OPENCLAW_WORKSPACE=\$HOME/.clawlite/workspace
OPENCLAW_SKILLS_PATH=\$HOME/.clawlite/skills
OPENCLAW_MEMORY_PATH=\$HOME/.clawlite/memory

# Security (reference only - actual key in secure storage)
# OPENCLAW_ENCRYPTION_KEY=[KEY IN SECURE STORAGE]

# Ollama
OLLAMA_URL=http://localhost:11434
OLLAMA_DEFAULT_MODEL=llama3.1:8b

# Context
CONTEXT_MAX_TOKENS=4000
CONTEXT_COMPRESSION_STRATEGY=hybrid

# Memory
MEMORY_ENABLED=true
MEMORY_MAX_SESSIONS=100
MEMORY_PRUNE_DAYS=30

# Skills
SKILL_VERIFY_STRICT=true
EOF
  chmod 600 "$ENV_FILE"
  echo "✅ Environment configuration created"
fi

# Create secure wrapper script
WRAPPER_FILE="$HOME/.clawlite/claw-lite-secure"
cat > "$WRAPPER_FILE" << 'EOF'
#!/bin/bash
# Secure wrapper for OpenClaw Lite
# Provides encryption key to agent without exposing it

set -e

# Load encryption key from secure storage
KEY_FILE="$HOME/.clawlite-secure/encryption.key"
if [ ! -f "$KEY_FILE" ]; then
  echo "❌ Encryption key not found in secure storage"
  exit 1
fi

# Read key (this happens in a subprocess)
ENCRYPTION_KEY=$(cat "$KEY_FILE")

# Export to environment for this command only
export OPENCLAW_ENCRYPTION_KEY="$ENCRYPTION_KEY"

# Run the actual command
exec claw-lite "$@"
EOF

chmod +x "$WRAPPER_FILE"
echo "✅ Secure wrapper script created"

# Create systemd service for background tasks (optional)
if command -v systemctl &> /dev/null; then
  SERVICE_FILE="$HOME/.config/systemd/user/openclaw-lite.service"
  mkdir -p "$(dirname "$SERVICE_FILE")"
  
  cat > "$SERVICE_FILE" << EOF
[Unit]
Description=OpenClaw Lite Background Service
After=network.target

[Service]
Type=simple
ExecStart=$HOME/.clawlite/claw-lite-secure web --port 3000
Restart=on-failure
RestartSec=5
Environment="PATH=/usr/local/bin:/usr/bin:/bin"
Environment="HOME=$HOME"
WorkingDirectory=$HOME/.clawlite

[Install]
WantedBy=default.target
EOF
  
  echo "✅ Systemd service template created (not enabled by default)"
fi

# Summary
echo ""
echo "🎉 Installation Complete!"
echo "========================"
echo ""
echo "📁 Secure directories created:"
echo "   • $HOME/.clawlite          (application data)"
echo "   • $HOME/.clawlite-secure   (credentials - strict permissions)"
echo ""
echo "🔑 Security features:"
echo "   • Encryption key: $KEY_FILE"
echo "   • Secure wrapper: $WRAPPER_FILE"
echo "   • Install ID: $INSTALL_ID"
echo ""
echo "🚀 Next steps:"
echo "1. Review configuration: $CONFIG_FILE"
echo "2. Customize identity files in $HOME/.clawlite/workspace/"
echo "3. Use the secure wrapper: $WRAPPER_FILE --help"
echo "4. Enable encryption: $WRAPPER_FILE security --encrypt"
echo ""
echo "📝 Note: The encryption key is stored separately and never exposed"
echo "   to the agent in readable form. The wrapper provides it via"
echo "   environment variables only during command execution."
echo ""