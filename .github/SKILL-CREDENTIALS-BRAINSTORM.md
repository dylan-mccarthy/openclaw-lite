# Skill Credential Management - Brainstorming Session

## 🎯 Problem Statement
Skills that interact with external services (APIs, databases, cloud services) need credentials, but we must:
1. **Keep credentials secure** - never exposed to the agent
2. **User consent required** - no automatic credential access
3. **Fine-grained control** - per-skill, per-service credentials
4. **Audit trail** - track credential usage

## 💡 Brainstorming Ideas

### Idea 1: Credential Vault with Skill-Specific Keys
```
.clawlite-secure/
├── encryption.key           # Master encryption
├── credentials/
│   ├── github-token.skill1 # Encrypted per-skill credentials
│   ├── api-key.skill2
│   └── database.skill3
└── manifests/
    ├── skill1-cred-manifest.json
    └── skill2-cred-manifest.json
```

### Idea 2: Interactive Credential Installation Flow
```
Skill Installation:
1. User: `claw-lite skills --install ./github-skill`
2. System: "This skill requires GitHub API access"
3. System: "Do you want to configure credentials now? (y/n)"
4. User: "y"
5. System: "Enter GitHub token: [hidden input]"
6. System: "Store in secure vault? (y/n)"
7. System: Credential encrypted and linked to skill
```

### Idea 3: Credential Scopes & Permissions
```json
{
  "skill": "github-integration",
  "requiredCredentials": [
    {
      "name": "github_token",
      "type": "oauth_token",
      "description": "GitHub API access",
      "scopes": ["repo:read", "user:read"],
      "permissions": ["read_repos", "read_user"]
    }
  ]
}
```

### Idea 4: Runtime Credential Injection
```typescript
// Skill requests credential
const credential = await CredentialManager.request(
  skillId, 
  "github_token",
  { reason: "Fetching user repos" }
);

// System checks:
// 1. Is skill verified? ✅
// 2. Does skill have permission? ✅  
// 3. Is credential available? ✅
// 4. Log the request? ✅
```

### Idea 5: Credential Lifecycle Management
```
Phases:
1. Discovery - Skill declares needed credentials
2. Installation - User provides credentials interactively
3. Storage - Encrypted in secure vault
4. Retrieval - Injected at runtime (agent can't see)
5. Rotation - Manual or automatic re-prompt
6. Revocation - User can revoke anytime
```

## 🔐 Security Considerations

### Threat Model:
1. **Skill tries to steal credentials** - Can't access vault directly
2. **Agent compromised** - Credentials not in agent memory
3. **Credential leakage** - Encrypted at rest, audit logs
4. **Unauthorized access** - Permission checks per skill

### Mitigations:
- **Never store plaintext credentials** in skill directory
- **Runtime injection only** - credentials never in skill code
- **Usage logging** - every credential access logged
- **Revocation capability** - instant credential disable

## 🛠️ Implementation Approaches

### Approach A: Central Credential Manager
```typescript
class CredentialManager {
  private vault: SecureVault;
  
  async installCredential(
    skillId: string,
    credentialType: string,
    value: string
  ): Promise<CredentialHandle> {
    // Encrypt and store in vault
    // Create permission manifest
    // Return handle for runtime use
  }
  
  async getCredential(
    skillId: string,
    credentialType: string,
    context: ExecutionContext
  ): Promise<string> {
    // Verify skill has permission
    // Decrypt from vault
    // Log access
    // Return credential
  }
}
```

### Approach B: Skill Credential Manifest
```json
{
  "skill": "weather-service",
  "version": "1.0.0",
  "credentials": {
    "openweather_api_key": {
      "type": "api_key",
      "required": true,
      "description": "OpenWeatherMap API key",
      "scopes": ["weather:read"],
      "prompt": "Enter your OpenWeatherMap API key:",
      "helpUrl": "https://openweathermap.org/api"
    }
  }
}
```

### Approach C: Interactive CLI Flow
```bash
$ claw-lite skills --install ./weather-skill
🔍 Scanning skill for credential requirements...
✅ Skill requires: OpenWeatherMap API key

? Configure credentials now? (Y/n) y
? Enter OpenWeatherMap API key: [hidden]
? Store securely? (Y/n) y
🔐 Credential encrypted and stored
✅ Skill installed with credentials
```

## 🔗 Integration Points

### 1. Skill Installation Pipeline
```
Install → Scan → Credential Check → Prompt → Store → Verify
```

### 2. Runtime Execution
```
Skill Execution → Credential Request → Permission Check → Inject → Execute
```

### 3. User Management
```
User Commands:
- `claw-lite credentials --list` - Show skill credentials
- `claw-lite credentials --add <skill>` - Add credential
- `claw-lite credentials --revoke <skill>` - Remove credential
- `claw-lite credentials --rotate <skill>` - Change credential
```

## 📋 Proposed Implementation Steps

### Phase 1: Credential Declaration
- Skill manifest extension for credential requirements
- Scanning during installation
- User prompt system

### Phase 2: Secure Storage
- Extend `.clawlite-secure` for credentials
- Per-skill encryption keys
- Credential manifest storage

### Phase 3: Runtime Injection  
- Credential manager service
- Permission verification
- Audit logging

### Phase 4: Management CLI
- User credential management
- Revocation/rotation
- Usage reports

## 🤔 Questions to Resolve

1. **Credential types to support?**
   - API keys
   - OAuth tokens  
   - Database URLs
   - SSH keys
   - Certificates

2. **Storage encryption strategy?**
   - Master key for all?
   - Per-skill keys?
   - Hierarchical keys?

3. **User interaction model?**
   - CLI prompts only?
   - Config file import?
   - Environment variable fallback?

4. **Credential lifecycle?**
   - Expiration dates?
   - Automatic rotation?
   - Usage limits?

## 🚀 Next Steps

1. **Design credential manifest schema**
2. **Extend skill installation flow**
3. **Build secure credential vault**
4. **Implement runtime injection**
5. **Add management CLI commands**

## 💭 Creative Ideas

### "Credential Pods"
Self-contained credential packages that can be:
- Backed up separately
- Transferred between installs
- Revoked independently of skills

### "Credential Leases"
Time-limited credential access:
- 1-hour token for risky operations
- Read-only vs read-write leases
- Automatic expiration

### "Credential Witness"
Two-party credential release:
- Skill requests credential
- User gets notification (push/email)
- User approves single use

### "Credential Fingerprinting"
Track credential usage patterns:
- Detect abnormal usage
- Geographic/IP anomaly detection
- Rate limiting alerts