# AWS Deployment Runbook

I did a throwaway EC2 + RDS deploy on 9/16 to prove the topology from our SAD
actually works before we try it for real in November. Everything got torn down
afterward. This is what I did, in order, plus everything that went wrong so we
don't lose an evening rediscovering it.

Account: 743434961847
Region: us-east-1 (stay in it, resources in different regions can't see
each other)

## Account status

We're on the new AWS Free Plan, not the old 12-month free tier. AWS changed
this in July 2025. Instead of certain services being free by category, you get
credits and they get drawn down.

    Credits available     $160.00
    Credits expire        09/17/2027
    Free plan window      ~6 months from account creation (mid-March 2027)

$100 was the base grant. The other $60 came from doing things in the console:
$20 each for setting up a budget, launching an EC2 instance, and creating an
RDS database.

Both of those dates are well past our December deadline, so cost isn't a real
constraint for this project. We can leave the November deployment running
continuously through the demo rather than stopping it between sessions.

Two things that would kill the credits instantly, so don't do either: joining
or creating an AWS Organization, and setting up a Control Tower landing zone.
Both expire the credits and flip the account to paid.

A zero-spend budget alert is configured and emails me if anything bills.

## What I built

Browser over the public internet, to an EC2 t3.micro running Node on port
3000, to an RDS PostgreSQL instance with no public address, reachable only
from the EC2 instance's security group. Same shape as the network topology
diagram in the SAD, minus the S3 and CloudWatch pieces.

## Steps

### 1. Account and guardrails

- Created a standalone AWS account, Free plan, no Organization
- MFA on the root user
- Created IAM user `kyle-admin` with AdministratorAccess and console access,
  then stopped using root
- Account alias set, so sign-in is
  https://kkishine-ift401.signin.aws.amazon.com/console
- Billing, Budgets, zero-spend budget with email alerts
- Set region to us-east-1

### 2. EC2

Launch instance:

    Name              stocktrader-spike
    AMI               Amazon Linux 2023
    Type              t3.micro
    Key pair          created new, RSA, .pem (saved outside the repo)
    Public IP         auto-assign ENABLED
    Security group    stocktrader-ec2-sg (new)

Inbound rules on stocktrader-ec2-sg:

    SSH        22     18.206.107.24/29   (see gotcha #1)
    Custom TCP 3000   0.0.0.0/0

Wait for Running and 2/2 status checks, then grab the public IP.

### 3. Hello world on EC2

Connected via EC2 Instance Connect (browser SSH, no .pem needed), then:

    sudo dnf update -y
    sudo dnf install -y nodejs
    mkdir spike && cd spike
    npm init -y
    npm install express

    cat > app.js <<'EOF'
    const express = require("express");
    const app = express();
    app.get("/", (req, res) => res.send("Stock trading spike is alive"));
    app.listen(3000, "0.0.0.0", () => console.log("listening on 3000"));
    EOF

    node app.js

Then hit http://<public-ip>:3000 in a browser. Type the http:// yourself,
browsers try https by default and there's no TLS on this.

Bind to 0.0.0.0, not localhost, or it's unreachable from outside the instance.

### 4. RDS

Create database:

    Engine            PostgreSQL  (NOT Aurora, see gotcha #2)
    Template          Free tier
    Availability      Single DB instance
    Identifier        stocktrader-spike-db
    Master username   trader
    Instance class    db.t3.micro
    Storage           20 GB gp3, autoscaling OFF
    Public access     NO
    Security group    stocktrader-rds-sg (new)
    Initial db name   stocktrader   (under Additional configuration,
                                     see gotcha #3)
    Backups           off
    Enhanced monitoring off

Takes 10-15 minutes to provision. Start it and go do something else.

### 5. The security group rule (this is the actual point)

On stocktrader-rds-sg, one inbound rule:

    Type      PostgreSQL
    Port      5432
    Source    stocktrader-ec2-sg   <- the security group, not an IP

Referencing a security group as the source is how AWS says "only machines in
this group." It keeps working when instances get replaced and IPs change,
which is why it's the right pattern instead of pinning an address. This is the
mechanism behind the "database is never directly reachable from the internet"
claim in our SAD security section.

### 6. Connection test

From the EC2 instance:

    sudo dnf install -y postgresql15
    psql -h <rds-endpoint> -U trader -d stocktrader

Result: connected as user trader over TLS 1.3 (TLS_AES_256_GCM_SHA384). RDS
encrypts connections by default, we didn't configure anything for that. The
RDS endpoint resolved to 172.31.72.38, a private VPC address, so the database
has no public address at all.

Worth knowing for the security section: encryption in transit between app and
database is already covered without extra work.

### 7. Teardown

Order matters and skipping any of these costs money.

1. RDS, Databases, Actions, Delete. Uncheck final snapshot, uncheck retain
   automated backups. Slowest step, start it first.
2. EC2, Instances, Instance state, TERMINATE (not Stop).
3. EC2, Elastic IPs, release anything listed. Unattached ones bill hourly.
4. EC2, Volumes, confirm nothing is in Available state.
5. EC2, Security Groups, delete both.
6. RDS, Snapshots, check both tabs and clear anything left.
7. Billing, Bills, confirm it looks like nothing.

## Gotchas (all of these cost me time)

**1. EC2 Instance Connect fails with "Error establishing SSH connection."**
Instance Connect comes from AWS IP ranges, not your laptop, so an SSH rule
scoped to "My IP" blocks it. Set the SSH source to 18.206.107.24/29 for
us-east-1. Different range in other regions. Alternative is SSHing with the
.pem from PowerShell, which does use your real IP.

**2. Aurora vs standard RDS.** The Create database screen has Amazon Aurora
and PostgreSQL as side-by-side cards and Aurora is often preselected. Aurora
is NOT free-tier eligible. I created one by accident and had to delete it.
Pick the PostgreSQL card first, then pick the Free tier template, which
constrains everything below it.

Deleting Aurora is also slower than it looks. The writer instance and the
cluster delete separately, and the cluster takes a final snapshot on the way
out. Check RDS, Snapshots afterward.

**3. "database stocktrader does not exist."** The Initial database name field
is buried under Additional configuration and easy to skip. If you miss it, RDS
creates the instance with no database on it. Fix:

    psql -h <endpoint> -U trader -d postgres
    CREATE DATABASE stocktrader;

**4. Can't change a security group rule from an IP to a group reference.**
AWS rejects it with "You may not specify a referenced group id for an existing
IPv4 CIDR rule." A rule's source type is fixed at creation. Delete the rule,
add a new one.

**5. PostgreSQL version mismatch.** RDS gave us 18.3. Our local Docker runs
16, and the psql client on Amazon Linux 2023 is 15. The version gap is real,
not theoretical: `\l` failed against the 18.3 server because psql 15 queries a
catalog column that got renamed. In November, pin the RDS engine version to
match whatever we develop against locally.

**6. Node version gap.** Amazon Linux 2023's default repo installs Node 18.
I'm on Node 24 locally. Something that runs on your machine can fail on the
instance if it uses a newer language feature. Either pin the team to 18
locally or install a matching version on the server via nodesource.

**7. Billing pages show "You need permissions" even as an admin IAM user.**
Only root can turn this on, by design. Sign in as root, Account menu, Account,
"IAM user and role access to billing information," Edit, Activate IAM Access.
Then sign back in as the IAM user.

**8. The region selector is greyed out on Billing and IAM pages.** Those are
global services. Navigate to EC2 first, then set the region.

## What November needs on top of this

The spike proved the path works. The real deployment still needs:

- HTTPS. The spike ran plain http on port 3000 with a browser "Not secure"
  warning. Production needs an ACM certificate and traffic on 443.
- A real domain via Route 53, since the public IP changes whenever the
  instance stops and starts.
- The application deployed rather than a hello world: our API, the frontend,
  and the price generator, with the generator on a schedule.
- The schema loaded into RDS. Our /db SQL files run automatically under
  docker-compose but that's a local convenience, not something RDS does.
- A process manager (pm2 or systemd) so the app restarts on reboot instead of
  dying with the SSH session.
- ALLOWED_ORIGIN set in the environment so CORS locks to the real domain
  instead of staying open.
- CloudWatch alarms on CPU and status checks, and S3 for database backups,
  both of which are in the SAD but weren't part of this spike.

Expect the real deployment to take longer than this did. Budget a full day,
not an evening.
