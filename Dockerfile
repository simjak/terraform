FROM public.ecr.aws/ubuntu/ubuntu:22.04 AS core

ARG DEBIAN_FRONTEND="noninteractive"

# Install git, SSH, and other utilities
RUN set -ex \
    && echo 'Acquire::CompressionTypes::Order:: "gz";' > /etc/apt/apt.conf.d/99use-gzip-compression \
    && apt-get update \
    && apt install -y -qq apt-transport-https gnupg ca-certificates \
    && apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys 3FA7E0328081BFF6A14DA29AA6A19B38D3D831EF \
    && apt-get install software-properties-common gnupg2 -y -qq --no-install-recommends \
    && apt-add-repository -y ppa:git-core/ppa \
    && apt-get update \
    && apt-get install git=1:2.* -y -qq --no-install-recommends \
    && git version \
    && apt-get install -y -qq --no-install-recommends openssh-client \
    && mkdir ~/.ssh \
    && mkdir -p /codebuild/image/config \
    && touch ~/.ssh/known_hosts \
    && ssh-keyscan -t rsa,dsa -H github.com >> ~/.ssh/known_hosts \
    && ssh-keyscan -t rsa,dsa -H bitbucket.org >> ~/.ssh/known_hosts \
    && chmod 600 ~/.ssh/known_hosts \
    && apt-get install -y -qq --no-install-recommends \
    apt-utils asciidoc autoconf automake build-essential bzip2 \
    bzr curl dirmngr docbook-xml docbook-xsl dpkg-dev \
    e2fsprogs expect fakeroot file g++ gcc gettext gettext-base \
    groff gzip iptables jq less libapr1 libaprutil1 \
    libargon2-0-dev libbz2-dev libc6-dev libcurl4-openssl-dev \
    libdb-dev libdbd-sqlite3-perl libdbi-perl libdpkg-perl \
    libedit-dev liberror-perl libevent-dev libffi-dev libgeoip-dev \
    libglib2.0-dev libhttp-date-perl libio-pty-perl libjpeg-dev \
    libkrb5-dev liblzma-dev libmagickcore-dev libmagickwand-dev \
    libmysqlclient-dev libncurses5-dev libncursesw5-dev libonig-dev \
    libpq-dev libreadline-dev libserf-1-1 libsodium-dev libsqlite3-dev libssl-dev \
    libsvn1 libsvn-perl libtcl8.6 libtidy-dev libtimedate-perl \
    libtool libwebp-dev libxml2-dev libxml2-utils libxslt1-dev \
    libyaml-dev libyaml-perl llvm locales make mlocate \
    netbase openssl patch pkg-config procps python3-configobj \
    python3-openssl rsync sgml-base sgml-data \
    tar tcl tcl8.6 tk tk-dev unzip wget xfsprogs xml-core xmlto xsltproc \
    libzip-dev vim xvfb xz-utils zip zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

RUN curl https://apt.releases.hashicorp.com/gpg | gpg --dearmor > hashicorp.gpg
RUN install -o root -g root -m 644 hashicorp.gpg /etc/apt/trusted.gpg.d/
RUN apt-add-repository "deb [arch=$(dpkg --print-architecture)] https://apt.releases.hashicorp.com $(lsb_release -cs) main"
RUN apt install terraform

ENV LC_CTYPE="C.UTF-8"

RUN useradd codebuild-user

#=======================End of layer: core  =================


FROM core AS tools

# AWS Tools
# https://docs.aws.amazon.com/eks/latest/userguide/install-aws-iam-authenticator.html https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ECS_CLI_installation.html
RUN curl -sS -o /usr/local/bin/aws-iam-authenticator https://s3.us-west-2.amazonaws.com/amazon-eks/1.22.6/2022-03-09/bin/linux/amd64/aws-iam-authenticator \
    && curl -sS -o /usr/local/bin/kubectl https://s3.us-west-2.amazonaws.com/amazon-eks/1.22.6/2022-03-09/bin/linux/amd64/kubectl \
    && curl -sS -o /usr/local/bin/ecs-cli https://s3.amazonaws.com/amazon-ecs-cli/ecs-cli-linux-amd64-latest \
    && curl -sS -L https://github.com/weaveworks/eksctl/releases/latest/download/eksctl_Linux_amd64.tar.gz | tar xz -C /usr/local/bin \
    && chmod +x /usr/local/bin/kubectl /usr/local/bin/aws-iam-authenticator /usr/local/bin/ecs-cli /usr/local/bin/eksctl

# Configure SSM
RUN set -ex \
    && mkdir /tmp/ssm \
    && cd /tmp/ssm \
    && wget -q https://s3.amazonaws.com/amazon-ssm-us-east-1/latest/debian_amd64/amazon-ssm-agent.deb \
    && dpkg -i amazon-ssm-agent.deb

# Install AWS CLI v2
# https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2-linux.html
RUN curl https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip -o /tmp/awscliv2.zip \
    && unzip -q /tmp/awscliv2.zip -d /opt \
    && /opt/aws/install --update -i /usr/local/aws-cli -b /usr/local/bin \
    && rm /tmp/awscliv2.zip \
    && rm -rf /opt/aws \
    && aws --version

# Install env tools for runtimes
#nodejs
ARG SRC_DIR="/usr/src"
ARG N_SRC_DIR="$SRC_DIR/n"
RUN git clone https://github.com/tj/n $N_SRC_DIR \
    && cd $N_SRC_DIR && make install 

#=======================End of layer: tools  =================
FROM tools AS runtimes


#****************      NODEJS     ****************************************************

ENV NODE_19_VERSION="19.5.0"
ARG CDKTF_VERSION="0.15.2"

RUN  n $NODE_19_VERSION && npm install --save-dev -g -f grunt \
    && npm install --save-dev -g -f grunt-cli  \ 
    && npm install --save-dev -g -f webpack \
    && npm install --save-dev -g -f webpack \
    && npm install --save-dev -g -f cdktf-cli@0.15.2 \
    && curl -sS https://dl.yarnpkg.com/debian/pubkey.gpg | apt-key add - \
    && echo "deb https://dl.yarnpkg.com/debian/ stable main" | tee /etc/apt/sources.list.d/yarn.list \
    && apt-get update && apt-get install -y -qq --no-install-recommends yarn \
    && yarn --version \
    && cd / && rm -rf $N_SRC_DIR && rm -rf /tmp/*

#****************      END NODEJS     ****************************************************


#=======================End of layer: runtimes  =================

FROM runtimes AS runtimes_n_corretto

#****************        DOCKER    *********************************************
ARG DOCKER_BUCKET="download.docker.com"
ARG DOCKER_CHANNEL="stable"
ARG DIND_COMMIT="3b5fac462d21ca164b3778647420016315289034"
ARG DOCKER_COMPOSE_VERSION="2.6.0"
ARG SRC_DIR="/usr/src"

ARG DOCKER_SHA256="969210917b5548621a2b541caf00f86cc6963c6cf0fb13265b9731c3b98974d9"
ARG DOCKER_VERSION="20.10.17"

# Install Docker
RUN set -ex \
    && curl -fSL "https://${DOCKER_BUCKET}/linux/static/${DOCKER_CHANNEL}/x86_64/docker-${DOCKER_VERSION}.tgz" -o docker.tgz \
    && echo "${DOCKER_SHA256} *docker.tgz" | sha256sum -c - \
    && tar --extract --file docker.tgz --strip-components 1  --directory /usr/local/bin/ \
    && rm docker.tgz \
    && docker -v \
    # set up subuid/subgid so that "--userns-remap=default" works out-of-the-box
    && addgroup dockremap \
    && useradd -g dockremap dockremap \
    && echo 'dockremap:165536:65536' >> /etc/subuid \
    && echo 'dockremap:165536:65536' >> /etc/subgid \
    && wget -q "https://raw.githubusercontent.com/docker/docker/${DIND_COMMIT}/hack/dind" -O /usr/local/bin/dind \
    && curl -L https://github.com/docker/compose/releases/download/v${DOCKER_COMPOSE_VERSION}/docker-compose-Linux-x86_64 > /usr/local/bin/docker-compose \
    && chmod +x /usr/local/bin/dind /usr/local/bin/docker-compose \
    # Ensure docker-compose works
    && docker-compose version

VOLUME /var/lib/docker
#*********************** END  DOCKER  ****************************

#=======================End of layer: corretto  =================
FROM runtimes_n_corretto AS std_v6

# Activate runtime versions specific to image version.
RUN n $NODE_19_VERSION


ENTRYPOINT ["/usr/local/bin/dockerd-entrypoint.sh"]

#=======================END