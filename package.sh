#!/bin/bash -e
date=$(git log -1 --date=short --pretty=format:%cd || date -u)

rm -rf node_modules
if [ -z "${ADDON_ARCH}" ]; then
  TARFILE_SUFFIX=
else
  NODE_VERSION="$(node --version)"
  TARFILE_SUFFIX="-${ADDON_ARCH}-${NODE_VERSION/\.*/}"
fi
# For openwrt-linux-arm and linux-arm we need to cross compile.
if [[ "${ADDON_ARCH}" =~ "linux-arm" ]]; then
  # We assume that CC and CXX are pointing to the cross compilers
  npm install --ignore-scripts --production
  npm rebuild --arch=armv6l --target_arch=arm
else
  npm install --production
fi

rm -f SHA256SUMS
sha256sum package.json *.js LICENSE > SHA256SUMS
find node_modules -type f -exec sha256sum {} \; >> SHA256SUMS
TARFILE="$(npm pack)"
tar xzf ${TARFILE}
rm ${TARFILE}
TARFILE_ARCH="${TARFILE/.tgz/${TARFILE_SUFFIX}.tgz}"
cp -r node_modules ./package
GZIP="-n" tar czf "${TARFILE_ARCH}" --mtime="${date}" package
rm -rf package
echo "Created ${TARFILE_ARCH}"
sha256sum "${TARFILE_ARCH}"
