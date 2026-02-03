# OpenClaw Lite Security Architecture

## 🏗️ Secure Design Overview

OpenClaw Lite implements a **security-first architecture** with isolated credential storage and strict verification.

## 📁 Directory Structure

```
~/.clawlite/                  # Application data (readable by agent)
├── workspace/                # Identity files (SOUL.md, USER.md, etc.)
├── skills/                   # Verified skills
├── memory/                   # Session memory
├── logs/                     # Audit logs
└── config.json              # Configuration

~/.clawlite-secure/          # Credentials (isolated, strict permissions)
├── encryption.key           # AES-256-GCM encryption key
└── [future credentials]     # API keys, tokens, etc.
```

## 🔐 Key Security Features

### 1. Isolated Credential Storage
- **Agent cannot read** `.clawlite-secure` directory directly
- **Strict permissions** (700 on directory, 600 on keys)
- **Wrapper script** provides keys via environment variables only

### 2. Encrypted Sensitive Files
- **SOUL.md, USER.md, MEMORY.md** encrypted at rest
- **Transparent encryption/decryption** when key available
- **AES-256-GCM** with unique IV per encryption

### 3. Skill Verification
- **Prompt injection scanning** before installation
- **SHA-256 hashing** of all skill files
- **Manifest storage** with verification status
- **Execution blocked** for unverified skills

### 4. Secure Installation
- **Automated setup** with `scripts/secure-install.sh`
- **Key generation** on first install
- **Proper permissions** configuration
- **Secure wrapper** for key management

## 🚀 Installation Process

### Quick Start
```bash
# Run secure installation
./scripts/secure-install.sh

# Use the secure wrapper
~/.clawlite/claw-lite-secure --help

# Enable encryption
~/.clawlite/claw-lite-secure security --encrypt
```

### Manual Setup
1. **Create directories:**
   ```bash
   mkdir -p ~/.clawlite ~/.clawlite-secure
   chmod 700 ~/.clawlite-secure
   ```

2. **Generate encryption key:**
   ```bash
   openssl rand -base64 32 > ~/.clawlite-secure/encryption.key
   chmod 600 ~/.clawlite-secure/encryption.key
   ```

3. **Set environment variable:**
   ```bash
   export OPENCLAW_ENCRYPTION_KEY=$(cat ~/.clawlite-secure/encryption.key)
   ```

## 🔧 Security Components

### SecureKeyManager
- Manages keys in isolated storage
- Provides keys via environment to child processes
- Prevents direct key access by agent

### FileSecurityManager
- Transparent file encryption/decryption
- Automatic encryption of sensitive files
- Whitelist for non-sensitive files

### SkillVerifier
- Scans for prompt injection patterns
- Computes file hashes for verification
- Maintains skill manifest with trust status

### SkillManager
- Enforces verification before execution
- Sandboxes skill execution (future)
- Monitors resource usage (future)

## 🛡️ Threat Mitigation

### Prompt Injection
- **Pattern scanning** for known injection techniques
- **Hash verification** prevents tampering
- **Execution guard** blocks unverified skills

### Credential Exposure
- **Isolated storage** prevents direct reading
- **Environment-only access** via wrapper
- **No key logging** in memory or files

### File Tampering
- **Encryption at rest** for sensitive files
- **Hash verification** for skills
- **Audit logging** of all operations

## 📊 Security Status Commands

```bash
# Check encryption status
claw-lite security --status

# List verified skills
claw-lite skills --list

# Verify a specific skill
claw-lite skills --verify <skill-name>

# Install and verify a skill
claw-lite skills --install <path-or-url>
```

## 🔮 Future Security Enhancements

### Planned Features:
1. **Execution sandboxing** - Isolate skill execution
2. **Network access control** - Limit skill network calls  
3. **File permission system** - Fine-grained file access
4. **Audit trail encryption** - Tamper-evident logs
5. **Key rotation** - Automatic key rotation system

### Integration Points:
- **System keychain** integration (macOS/Windows)
- **Hardware security modules** (HSM) support
- **Multi-factor authentication** for critical operations

## ⚠️ Security Considerations

### Current Limitations:
- **Memory exposure** - Keys may be in process memory
- **No sandboxing** - Skills run in same process
- **Basic scanning** - Prompt injection detection is basic

### Best Practices:
1. **Regular updates** - Keep OpenClaw Lite updated
2. **Key backup** - Securely backup encryption key
3. **Audit reviews** - Regularly review audit logs
4. **Skill vetting** - Only install trusted skills
5. **Network isolation** - Run in isolated network when possible

## 🔗 Related Files
- `src/security/` - Security implementation
- `scripts/secure-install.sh` - Installation script
- `.github/ISSUES.md` - Security roadmap
- `.env.example` - Security configuration template