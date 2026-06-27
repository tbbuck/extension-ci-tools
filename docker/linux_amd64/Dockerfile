FROM quay.io/pypa/manylinux_2_28_x86_64

# Setup the basic necessities.
# cow diet: consolidated into a single layer with the yum cache cleaned in the
# SAME layer (so the metadata bytes don't persist), and dropped
# java-11-openjdk-devel + maven (a JVM-client toolchain a Rust extension never
# uses).
RUN yum groupinstall -y "Development Tools" && \
    yum install -y \
      curl zip unzip tar autoconf libtool \
      ninja-build perl-IPC-Cmd perl-core ccache wget \
      kernel-headers kernel-devel glibc-devel jq && \
    yum clean all && rm -rf /var/cache/yum

# We need a recent CMake
RUN mkdir /cmake_4_02 && \
    cd /cmake_4_02 && \
    wget https://github.com/Kitware/CMake/releases/download/v4.0.2/cmake-4.0.2-linux-x86_64.sh && \
    chmod +x cmake-4.0.2-linux-x86_64.sh  && \
    ./cmake-4.0.2-linux-x86_64.sh --skip-license --prefix=/usr/local && \
    cmake --version && \
    cd / && rm -rf /cmake_4_02

# cow diet: dropped the AWS CLI — the deploy job runs `aws s3 sync` outside the
# container (on the ubuntu-latest runner), so the in-image copy was dead weight.

# Setup VCPKG n a mounted volume TODO: figure out how to cache this
ARG vcpkg_url
ARG vcpkg_commit
RUN mkdir /vcpkg && \
    cmake --version && \
    cd /vcpkg && \
    git init && \
    git remote add origin $vcpkg_url && \
    git fetch origin $vcpkg_commit && \
    git checkout $vcpkg_commit && \
    ./bootstrap-vcpkg.sh
ENV VCPKG_ROOT=/vcpkg
ENV VCPKG_TOOLCHAIN_PATH=/vcpkg/scripts/buildsystems/vcpkg.cmake
ENV PATH="${VCPKG_ROOT}:${PATH}"

# Common environment variables
ENV GEN=ninja

# Specify where we expect the extension to be mounted and use that as working dir
VOLUME /duckdb_build_dir
WORKDIR /duckdb_build_dir

# Allow git access to the mounted volume
RUN git config --global --add safe.directory "*"

# Mount for ccache to allow restoring ccache in GH actions
VOLUME /ccache_dir
ENV CCACHE_DIR=/ccache_dir
ENV CCACHE_COMPRESS=TRUE
ENV CCACHE_COMPRESSLEVEL=6
ENV CCACHE_MAXSIZE=400M

###
# Conditionally configure some extra dependencies
###
# a `;` separated list of extra toolchains to install (passed in like this to makes things easier through GitHub Actions)
# Note that it should start and end with a `;` e.g. `;rust;parser_tools;`
ARG extra_toolchains

# NOTE: the weird case conditionals are because of bash limitations in the ubuntu image used (see https://stackoverflow.com/questions/229551/how-to-check-if-a-string-contains-a-substring-in-bash)

# Install Parser tools
RUN case "$extra_toolchains" in \
  *\;parser_tools\;*) \
   yum install -y bison flex \
  ;; \
esac

# Install Fortran
RUN case "$extra_toolchains" in \
  *\;fortran\;*) \
    yum install -y gcc-gfortran \
  ;; \
esac

# Configure Rust
ENV PATH="/root/.cargo/bin:${PATH}"
RUN case "$extra_toolchains" in \
  *\;rust\;*) \
    curl https://sh.rustup.rs -sSf | bash -s -- -y --profile minimal; \
  ;; \
esac

# Configure go
ENV PATH="/usr/local/go/bin:${PATH}"
RUN case "$extra_toolchains" in \
  *\;go\;*) \
    wget https://go.dev/dl/go1.20.5.linux-amd64.tar.gz && \
    tar -xzvf go1.20.5.linux-amd64.tar.gz && \
    mv go /usr/local &&\
    go version \
  ;; \
esac

# Install unixODBC
RUN case "$extra_toolchains" in \
  *\;unixodbc\;*) \
    yum install -y unixODBC-devel \
  ;; \
esac

# Install multimedia libraries (FFmpeg, SDL2) for audio/video extensions
# Requires EPEL and RPM Fusion repositories
RUN case "$extra_toolchains" in \
  *\;multimedia\;*) \
    yum install -y epel-release && \
    yum install -y --nogpgcheck https://mirrors.rpmfusion.org/free/el/rpmfusion-free-release-8.noarch.rpm && \
    yum install -y nasm SDL2-devel ffmpeg-devel \
  ;; \
esac
