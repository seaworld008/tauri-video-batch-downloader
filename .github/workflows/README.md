# GitHub Actions Workflows

This directory contains comprehensive CI/CD workflows for the Video Downloader
Pro project.

## 🔄 Workflows Overview

### 1. CI Workflow (`ci.yml`)

**Triggers**: Push to `main`/`dev`, Pull Requests **Purpose**: Continuous
Integration and Quality Assurance

**Jobs**:

- **Frontend CI**: TypeScript, ESLint, Prettier, Vitest tests
- **Backend CI**: Rust formatting, Clippy, tests (cross-platform)
- **Security Audit**: Vulnerability scanning, license checks
- **Build Check**: Ensures the app builds successfully
- **Dependency Review**: Reviews new dependencies in PRs
- **Performance Benchmarks**: Tracks performance metrics (main branch only)

### 2. Release Workflow (`release.yml`)

**Triggers**: Tags matching `v*`, Manual dispatch **Purpose**: Multi-platform
builds and releases

**Features**:

- Cross-platform builds (Windows, macOS, Linux)
- Code signing and notarization
- Automated release notes generation
- Checksum generation and verification
- Post-release distribution tasks

**Supported Platforms**:

- Windows x64 (MSI, EXE)
- macOS Intel/Apple Silicon (DMG)
- Linux (AppImage, DEB, RPM)

### 3. Security Workflow (`security.yml`)

**Triggers**: Weekly schedule, Push to main, Manual **Purpose**: Comprehensive
security auditing

**Security Checks**:

- Rust: `cargo audit`, `cargo deny`
- Frontend: `npm audit`, outdated packages
- CodeQL static analysis
- SBOM (Software Bill of Materials) generation
- License compliance verification

## 🚀 Getting Started

### Required Repository Secrets

For the workflows to function properly, configure these secrets in your GitHub
repository:

#### Code Signing (Optional but Recommended)

```bash
# Windows Code Signing
WINDOWS_CERTIFICATE          # Base64 encoded .p12 certificate
WINDOWS_CERTIFICATE_PASSWORD # Certificate password

# macOS Code Signing
APPLE_CERTIFICATE            # Base64 encoded .p12 certificate
APPLE_CERTIFICATE_PASSWORD   # Certificate password
APPLE_SIGNING_IDENTITY       # Developer ID Application: Your Name
KEYCHAIN_PASSWORD           # Temporary keychain password
APPLE_ID                    # Apple ID for notarization
APPLE_PASSWORD              # App-specific password
APPLE_TEAM_ID               # Developer Team ID

# Tauri Updater (Optional)
TAURI_PRIVATE_KEY           # Private key for update signing
TAURI_KEY_PASSWORD          # Private key password
```

#### Additional Services (Optional)

```bash
# Package Distribution
HOMEBREW_TAP_TOKEN          # For Homebrew formula updates
CHOCOLATEY_API_KEY          # For Chocolatey package updates
DOCKER_HUB_TOKEN           # For Docker image publishing

# Code Coverage
CODECOV_TOKEN               # For code coverage reporting
```

### Local Development Setup

1. **Install Dependencies**:

   ```bash
   pnpm install
   cd src-tauri && cargo check
   ```

2. **Run Quality Checks Locally**:

   ```bash
   # Frontend
   pnpm type-check
   pnpm lint
   pnpm test

   # Backend
   cd src-tauri
   cargo fmt --check
   cargo clippy
   cargo test
   ```

3. **Security Audits**:

   ```bash
   # Install tools
   cargo install cargo-audit cargo-deny

   # Run audits
   cd src-tauri
   cargo audit
   cargo deny check
   ```

## 📦 Release Process

### Automated Releases

1. **Create a Release Tag**:

   ```bash
   git tag -a v1.2.3 -m "Release v1.2.3

   ## Changes
   - Added new feature X
   - Fixed bug Y
   - Improved performance Z

   ## Breaking Changes
   - None

   ## Migration Guide
   - No migration required"

   git push origin v1.2.3
   ```

2. **Workflow Execution**:
   - Release workflow triggers automatically
   - Builds for all supported platforms
   - Creates draft GitHub release
   - Uploads signed binaries and checksums
   - Publishes release upon completion

### Manual Releases

Use the GitHub Actions web interface:

1. Go to Actions → Release workflow
2. Click "Run workflow"
3. Enter the tag to release
4. Click "Run workflow"

## 🔍 Monitoring and Troubleshooting

### Workflow Status

Monitor workflow execution:

- GitHub Actions tab
- Status badges in README
- Email notifications (configurable)

### Common Issues

1. **Build Failures**:
   - Check system dependencies
   - Verify cross-compilation setup
   - Review error logs in Actions tab

2. **Code Signing Issues**:
   - Ensure certificates are valid and not expired
   - Check certificate passwords
   - Verify signing identities

3. **Test Failures**:
   - Run tests locally first
   - Check for platform-specific issues
   - Review test environment setup

### Debugging

Enable debug logging by setting:

```bash
# In workflow environment
ACTIONS_STEP_DEBUG=true
ACTIONS_RUNNER_DEBUG=true
```

## 📊 Quality Metrics

### Code Coverage

- Frontend: Vitest + Istanbul
- Backend: `cargo tarpaulin` (optional)
- Reports uploaded to Codecov

### Performance Tracking

- Rust benchmarks with Criterion
- Bundle size analysis
- Load time metrics

### Security Metrics

- Vulnerability count over time
- Dependency freshness
- License compliance status

## 🔧 Customization

### Adding New Checks

1. **Create New Job in CI**:

   ```yaml
   new-check:
     name: New Check
     runs-on: ubuntu-latest
     steps:
       - uses: actions/checkout@v4
       - name: Run new check
         run: echo "Custom check here"
   ```

2. **Update Success Dependencies**:
   ```yaml
   ci-success:
     needs: [frontend, backend, security, build-check, new-check]
   ```

### Platform-Specific Builds

Add new platform to release workflow:

```yaml
matrix:
  platform:
    - os: new-os
      rust_target: new-target
      arch: new-arch
```

### Custom Notifications

Add notification steps to workflows:

```yaml
- name: Notify on failure
  if: failure()
  uses: 8398a7/action-slack@v3
  with:
    status: failure
    webhook_url: ${{ secrets.SLACK_WEBHOOK }}
```

## 📚 Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Tauri Guides](https://tauri.app/v1/guides/)
- [Rust CI/CD Best Practices](https://github.com/actions-rs)
- [Security Workflows](https://docs.github.com/en/code-security)

## 🤝 Contributing

When modifying workflows:

1. Test locally when possible
2. Use feature branches for changes
3. Update documentation
4. Consider backward compatibility
5. Test with draft releases before merging

## 📋 Workflow Maintenance

### Regular Tasks

- Review dependency updates monthly
- Update action versions quarterly
- Audit security configurations
- Monitor workflow performance metrics
- Update documentation as needed

### Version Updates

Keep these updated regularly:

- `actions/checkout` (currently v4)
- `actions/setup-node` (currently v4)
- `dtolnay/rust-toolchain` (currently stable)
- Platform-specific action versions

## 🏷️ Labels and Organization

Workflows automatically apply these labels:

- `dependencies`: Dependency updates
- `frontend`/`backend`: Component-specific
- `security`: Security-related changes
- `ci`/`cd`: CI/CD improvements
