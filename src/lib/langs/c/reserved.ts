/**
 * Names a C library or a system header may define as a macro, rename, or
 * declare: the standard library's, POSIX's and the BSDs' most used (those
 * glibc renames for large files or fortifies among them), and the Windows
 * headers' `min` and `max`. A call to one never draws a line, even where the
 * repository defines a function of that name: a header the board can't read
 * (`<string.h>` under `_FORTIFY_SOURCE`) may turn the call into something
 * else. So are names reserved to the implementation (`__x`, `_X`) and the
 * compiler's builtins. Some system and library headers define macros of
 * ordinary names too (`<curses.h>` makes `refresh()` one, GLEW every
 * `glCreateShader`, GMP every `mpz_add`): a unit that includes one draws no
 * line for a name it may define (`systemMacro`).
 */

const STANDARD = `abort abs acos acosf acosh acoshf acoshl acosl aligned_alloc alloca asctime asin asinf asinh asinhf asinhl asinl assert at_quick_exit atan atan2 atan2f atan2l atanf atanh atanhf atanhl atanl atexit atof atoi atol atoll bsearch btowc call_once calloc cbrt cbrtf cbrtl ceil ceilf ceill clearerr clock copysign copysignf copysignl cos cosf cosh coshf coshl cosl ctime difftime div erf erfc erfcf erfcl erff erfl errno exit exp exp2 exp2f exp2l expf expl expm1 expm1f expm1l fabs fabsf fabsl fclose fdim fdimf fdiml feof ferror fflush fgetc fgetpos fgets fgetwc fgetws floor floorf floorl fma fmaf fmal fmax fmaxf fmaxl fmin fminf fminl fmod fmodf fmodl fopen fpclassify fprintf fputc fputs fputwc fputws fread free freopen frexp frexpf frexpl fscanf fseek fsetpos ftell fwide fwprintf fwrite fwscanf getc getchar getenv gets getwc getwchar gmtime hypot hypotf hypotl ilogb isalnum isalpha isblank iscntrl isdigit isfinite isgraph isgreater isgreaterequal isinf isless islessequal islessgreater islower isnan isnormal isprint ispunct isspace isunordered isupper iswalnum iswalpha iswblank iswcntrl iswctype iswdigit iswgraph iswlower iswprint iswpunct iswspace iswupper iswxdigit isxdigit labs ldexp ldexpf ldexpl ldiv lgamma llabs lldiv llrint llround localeconv localtime log log10 log10f log10l log1p log1pf log1pl log2 log2f log2l logb logf logl longjmp lrint lround malloc mblen mbrlen mbrtowc mbsinit mbsrtowcs mbstowcs mbtowc memccpy memchr memcmp memcpy memmove memset memset_explicit mktime modf modff modfl nan nanf nanl nearbyint nextafter nexttoward offsetof perror pow powf powl printf putc putchar puts putwc putwchar qsort quick_exit raise rand realloc remainder remove remquo rename rewind rint round roundf roundl scalbln scalbn scanf setbuf setjmp setlocale setvbuf signal signbit sin sinf sinh sinhf sinhl sinl snprintf sprintf sqrt sqrtf sqrtl srand sscanf static_assert strcat strchr strcmp strcoll strcpy strcspn strdup strerror strftime strlen strncat strncmp strncpy strndup strpbrk strrchr strspn strstr strtod strtof strtoimax strtok strtol strtold strtoll strtoul strtoull strtoumax strxfrm swprintf swscanf system tan tanf tanh tanhf tanhl tanl tgamma time timespec_get tmpfile tmpnam tolower toupper towlower towupper trunc truncf truncl ungetc ungetwc unreachable va_arg va_copy va_end va_start vfprintf vfscanf vfwprintf vprintf vscanf vsnprintf vsprintf vsscanf vswprintf vwprintf wcrtomb wcscat wcschr wcscmp wcscpy wcslen wcsncat wcsncmp wcsncpy wcsrchr wcsstr wcstod wcstol wcstombs wcstoul wctomb wmemchr wmemcmp wmemcpy wmemmove wmemset wprintf wscanf`;

const SYSTEM = `alphasort accept access asprintf basename bcmp bcopy be16toh be32toh be64toh bind bswap_16 bswap_32 bswap_64 bzero chdir chmod chown clock_gettime close closedir confstr connect creat dirfd dirname dlclose dlopen dlsym dprintf dup dup2 dup3 environ explicit_bzero execl execlp execv execve execvp fchmod fcntl fdatasync fdopen fdopendir fileno flockfile fnmatch fork freeaddrinfo fseeko fstat fstatat fstatfs fstatvfs fsync ftello ftruncate ftw funlockfile gai_strerror getaddrinfo getc_unlocked getchar_unlocked getcwd getdelim getdomainname getegid getenv geteuid getgid getgroups gethostname getline getlogin_r getnameinfo getopt getopt_long getpid getppid getpwnam getpwuid getrlimit getrusage getsockname getsockopt gettimeofday getuid getwd glob globfree gmtime_r howmany htobe16 htobe32 htobe64 htole16 htole32 htole64 htonl htons index inet_ntop inet_pton ioctl isatty isclr isset kill le16toh le32toh le64toh link listen localtime_r lockf lseek lstat madvise major makedev max mempcpy min minor mkdir mkdtemp mknod mknodat mkostemp mkstemp mkstemps mmap mprotect msync munmap nanosleep nftw nitems ntohl ntohs open openat opendir pclose pipe pipe2 poll popen posix_fadvise posix_fallocate posix_memalign powerof2 ppoll pread prlimit pthread_cleanup_pop pthread_cleanup_push putc_unlocked putchar_unlocked pwrite read readdir readdir_r readlink realpath recv recvfrom rewinddir rindex rmdir roundup scandir seekdir sched_yield select send sendfile sendto setbit setenv setrlimit setsockopt shutdown sigaction sigaddset sigdelset sigemptyset sigfillset sigismember siglongjmp sigsetjmp sleep socket stat statfs statvfs stpcpy stpncpy strcasecmp strdupa strerror_r strlcat strlcpy strncasecmp strndupa strnlen strptime strsep strtok_r symlink sysconf telldir timegm timeradd timerclear timercmp timerisset timersub truncate ttyname_r umask uname unlink unsetenv usleep vasprintf vdprintf wait waitpid write`;

const NAMES = new Set(`${STANDARD} ${SYSTEM}`.split(/\s+/));

/** Whether a name may be the C library's, a system header's, or the compiler's. */
export const reserved = (name: string): boolean => NAMES.has(name) || /^(?:_[A-Z_]|__builtin_|__sync_|__atomic_)/.test(name);

/** Names the Windows SDK and X11 headers write as macros: a capital first and no lower-case word after an underscore (`CreateFile`, `MAKEWORD`), and a few lower-case ones. */
const capitalized = (name: string): boolean => /^[A-Z][A-Za-z0-9]*$|^[A-Z][A-Z0-9_]*$/.test(name) || /^(?:small|near|far|pascal|cdecl|interface|hyper|boolean)$/.test(name);

/** The macros curses defines with lower-case names, as ncurses does. */
const CURSES = new Set(`acs_map add_wch add_wchnstr add_wchstr addch addchnstr addchstr addnstr addnwstr addstr addwstr attr_get attr_off attr_on attr_set attroff attron attrset bkgd bkgdset bkgrnd bkgrndset border border_set box box_set chgat clear clrtobot clrtoeol color_set crmode curscr curses_version delch deleteln echo_wchar echochar erase fixterm get_wch get_wstr getattrs getbegx getbegy getbegyx getbkgd getbkgrnd getch getcurx getcury getmaxx getmaxy getmaxyx getn_wstr getnstr getparx getpary getparyx getstr getsyx gettmode getyx hline hline_set in_wch in_wchnstr in_wchstr inch inchnstr inchstr innstr innwstr ins_nwstr ins_wch ins_wstr insch insdelln insertln insnstr insstr instr inwstr is_cleared is_idcok is_idlok is_immedok is_keypad is_leaveok is_nodelay is_notimeout is_pad is_scrollok is_subwin is_syncok mouse_trafo move mvadd_wch mvadd_wchnstr mvadd_wchstr mvaddch mvaddchnstr mvaddchstr mvaddnstr mvaddnwstr mvaddstr mvaddwstr mvchgat mvdelch mvget_wch mvget_wstr mvgetch mvgetn_wstr mvgetnstr mvgetstr mvhline mvhline_set mvin_wch mvin_wchnstr mvin_wchstr mvinch mvinchnstr mvinchstr mvinnstr mvinnwstr mvins_nwstr mvins_wch mvins_wstr mvinsch mvinsnstr mvinsstr mvinstr mvinwstr mvvline mvvline_set mvwadd_wch mvwadd_wchnstr mvwadd_wchstr mvwaddch mvwaddchnstr mvwaddchstr mvwaddnstr mvwaddnwstr mvwaddstr mvwaddwstr mvwchgat mvwdelch mvwget_wch mvwget_wstr mvwgetch mvwgetn_wstr mvwgetnstr mvwgetstr mvwhline mvwhline_set mvwin_wch mvwin_wchnstr mvwin_wchstr mvwinch mvwinchnstr mvwinchstr mvwinnstr mvwinnwstr mvwins_nwstr mvwins_wch mvwins_wstr mvwinsch mvwinsnstr mvwinsstr mvwinstr mvwinwstr mvwvline mvwvline_set newscr nocrmode redrawwin refresh resetterm saveterm scrl scroll setscrreg setsyx setterm slk_attr_off slk_attr_on standend standout stdscr timeout touchline touchwin ttytype untouchwin vid_attr vline vline_set vw_printw vw_scanw wadd_wchstr waddchstr waddstr waddwstr wattr_get wattr_set wattroff wattron wattrset wdeleteln wget_wstr wgetbkgrnd wgetdelay wgetparent wgetscrreg wgetstr win_wchstr winchstr wins_wstr winsertln winsstr winstr wstandend wstandout`.split(" "));

/** Names that start with one of the prefixes. */
const starting = (re: RegExp) => (name: string) => re.test(name);

/**
 * Headers outside the repository known to define macros of ordinary names,
 * and the names each may define: the C library's and POSIX's few, and the
 * macro-heavy libraries' (those that rename their API, `#define mpz_add
 * __gmpz_add`, load it through a table, `#define glCreateShader
 * glad_glCreateShader`, or wrap it, `#define curl_easy_setopt(…)`).
 */
const SYSTEM_MACROS: [RegExp, (name: string) => boolean, windows?: true][] = [
    // curses: its macros, ncurses' (`refresh`, `getyx`, `mvaddstr`); terminfo's capabilities are many more lower-case words (`columns`, `lines`): any name.
    [/^(?:n?cursesw?|pdcurses|panel|menu|form|cursesapp|cursesf|cursesm|cursesp|cdk|dialog)\.h$|^(?:ncursesw?|curses|cdk)\/(?!term)/, (n) => CURSES.has(n)],
    [/^(?:term|termcap|terminfo|term_entry|unctrl|eti)\.h$|^(?:ncursesw?|curses)\/term/, () => true],
    [/^(?:windows|win[a-z0-9]*|ws2[a-z0-9]*|winsock2?|mswsock|commctrl|commdlg|shlwapi|shlobj|shellapi|objbase|ole2|oleauto|tchar|mmsystem|iphlpapi|psapi|tlhelp32|dbghelp|userenv|lmcons|ntsecapi|sspi|security|schannel|bcrypt|ncrypt|aclapi|sddl|wincrypt|richedit|uxtheme|dwmapi|setupapi|imm|mmreg|dsound|dinput|d3d[a-z0-9]*|dxgi[a-z0-9]*)\.h$/i, capitalized],
    [/^X11\//, capitalized],
    // Apple's frameworks: their specifier macros (`CF_INLINE`, `OS_ALWAYS_INLINE`, `API_AVAILABLE(…)`).
    [/^(?:CoreFoundation|CoreServices|Foundation|Security|SystemConfiguration|IOKit|CoreGraphics|ApplicationServices|Carbon|os|dispatch|libkern)\/|^(?:Availability|AvailabilityMacros|TargetConditionals|ConditionalMacros)\.h$/, starting(/^(?:CF|NS|OS|API|SPI|DISPATCH|IOKIT|AVAILABLE|DEPRECATED|TARGET|MAC_OS_X|kCF)_|^CFSTR$/)],
    [/^(?:zlib|zconf)\.h$/, starting(/^(?:deflate|inflate|gz|compress|uncompress|crc32|adler32|zlib|zError|get_crc_table|z_)/)],
    [/^(?:openssl|wolfssl|boringssl|libressl)\//, starting(/^(?:[A-Z][A-Z0-9]*_|sk_|lh_|d2i_|i2d_|ossl_|wolfSSL_|wc_)/)],
    [/^iconv\.h$/, starting(/^iconv/)],
    [/^libintl\.h$/, (n) => /^(?:d?c?n?gettext|textdomain|bindtextdomain|bind_textdomain_codeset)$/.test(n)],
    [/^sys\/(?:queue|tree)\.h$/, starting(/^(?:S?LIST|STAILQ|TAILQ|CIRCLEQ|X?SIMPLEQ|RB|SPLAY)_|_(?:RB|SPLAY)_[A-Z]/)],
    [/^sys\/param\.h$/, (n) => /^(?:MIN|MAX|howmany|roundup|rounddown|powerof2|nitems|setbit|clrbit|isset|isclr)$/.test(n)],
    [/^complex\.h$/, (n) => /^(?:c(?:abs|acos|acosh|arg|asin|asinh|atan|atanh|cos|cosh|exp|imag|log|pow|proj|real|sin|sinh|sqrt|tan|tanh)[fl]?|conj[fl]?|CMPLX[FL]?|I|complex|imaginary)$/.test(n)],
    [/^stdatomic\.h$/, starting(/^(?:atomic_|kill_dependency$)/)],
    [/^threads\.h$/, starting(/^(?:thrd_|mtx_|cnd_|tss_|call_once$)/)],
    [/^(?:glib|gio|gobject|gtk|gdk|gmodule)(?:-[\d.]+)?(?:\/|\.h$)/, starting(/^(?:g_|G_|_g_|gtk_|GTK_|gdk_|GDK_)|_(?:get_type|class_init|init|parent_class|get_instance_private)$/)],
    // The compilers' intrinsics: `_mm_*`, NEON's `vaddq_u8`, AltiVec's `vector` and `vec_*`.
    [/^(?:[a-z0-9]*intrin|cpuid)\.h$/, starting(/^_(?:mm|m_|tile|rd|wr|bit|bswap|byteswap|cvt|pdep|pext|lzcnt|tzcnt|popcnt|xbegin|xend|xabort|xtest|xgetbv|xsetbv|addcarry|subborrow|mulx|umul|mul128|load|store|rot|lrot|cast|blsr|blsi|bextr|bzhi|andn)/)],
    [/^(?:arm_neon|arm_sve|arm_acle|arm_fp16|arm_bf16)\.h$/, (n) => /^v[a-z0-9]+(?:_(?:lane|laneq|n|high|low|x\d|[a-z]+\d+))+$|^sv[a-z0-9_]+$|^__arm_/.test(n)],
    [/^(?:altivec|riscv_vector)\.h$/, (n) => /^(?:vec_\w+|vector|pixel|bool|__riscv_\w+)$/.test(n)],
    // Graphics: GL and its loaders (GLEW, glad, epoxy, gl3w), EGL, GLFW, Vulkan and its loaders, OpenCL, SDL (its `main` too).
    [/^(?:GL|GLES\d*|OpenGL|OpenGLES|glad|epoxy|KHR|GLFW|EGL)\/|^(?:glew|glxew|wglew|glad|gl3w|glfw3?|glext|glcorearb)\.h$/, starting(/^(?:gl[A-Z]|glew|glad|epoxy_|gl3w|glfw[A-Z]|wgl[A-Z]|glX|egl[A-Z]|GL_|GLEW_|GLX_|WGL_|EGL_|GLFW_)/)],
    [/^vulkan\/|^volk\.h$/, starting(/^(?:vk[A-Z]|VK_)/)],
    [/^(?:CL|OpenCL)\//, starting(/^(?:cl[A-Z]|CL_)/)],
    [/^SDL\d*(?:\/|\.h$|_\w+\.h$)/, (n) => /^SDL_|^main$/.test(n), true],
    // Embedded languages: Tcl and Tk (their stubs tables), Python, Ruby, Perl (any lower-case API name), Lua, Guile.
    [/^(?:tcl|tk|tclDecls|tkDecls|tclPlatDecls|tkPlatDecls)\.h$/, starting(/^(?:Tcl_|Tk_|Tcl[A-Z]|Tk[A-Z]|TCL_|TK_)/)],
    [/^(?:Python|pyconfig|structmember|frameobject)\.h$|^python[\d.]*\//, starting(/^_?Py[A-Z_]|^PY_/)],
    [/^ruby(?:\.h$|\/)/, starting(/^(?:rb_|ruby_|RB_|RUBY_|R[A-Z]+_)/)],
    [/^(?:perl|EXTERN|XSUB)\.h$/, () => true],
    [/^(?:lua|lauxlib|lualib|luajit|luaconf)\.h$|^lua[\d.]*\//, starting(/^(?:lua_|luaL_|luaopen_|lua[A-Z]|LUA_|LUAI_|LUAL_)/)],
    [/^libguile\.h$|^libguile\//, starting(/^(?:scm_|SCM_)/)],
    // Numbers: GMP, MPFR, MPC.
    [/^(?:gmp|gmpxx|mpfr|mpc|mpf2mpfr)\.h$/, starting(/^(?:mpz_|mpq_|mpf_|mpn_|gmp_|mpfr_|mpc_|__gmp|__mpfr|MPFR_|MPC_|GMP_)/)],
    // Text: ICU (versioned names), PCRE, Oniguruma.
    [/^unicode\//, starting(/^(?:u[a-z]*_|U_|UCHAR_|UTEXT_)/)],
    [/^pcre2?(?:posix)?\.h$/, starting(/^(?:pcre2?_|PCRE2?_|reg(?:comp|exec|error|free)$)/)],
    [/^(?:oniguruma|onigmo|onigposix)\.h$/, starting(/^(?:onig_|ONIG_|Onig|onigenc_|ONIGENC_|reg(?:comp|exec|error|free)$)/)],
    // Allocators that rename malloc's family or theirs.
    [/^jemalloc(?:\/|\.h$)/, starting(/^(?:je_|mallocx|rallocx|xallocx|sallocx|dallocx|sdallocx|nallocx|mallctl|malloc_)/)],
    [/^mimalloc(?:-[a-z]+)?\.h$/, starting(/^(?:mi_|MI_)/)],
    [/^(?:gperftools|google)\/|^tcmalloc\.h$/, starting(/^(?:tc_|MallocExtension)/)],
    // Compute: CUDA, MPI, OpenMP, hwloc (its symbol prefix), NUMA.
    [/^(?:cuda\w*|cublas\w*|cudnn|cufft\w*|curand\w*|cusparse\w*|cusolver\w*|nvrtc|nvml|nccl)\.h$/, starting(/^(?:cu[A-Z]|cuda[A-Z]|cublas|cudnn|cufft|curand|cusparse|cusolver|nvrtc|nvml|nccl|CU[A-Z_]|CUDA_|CUBLAS_|CUDNN_)/)],
    [/^mpi\.h$/, starting(/^P?MPIX?_/)],
    [/^omp\.h$/, starting(/^omp_/)],
    [/^hwloc(?:\/|\.h$)/, starting(/^(?:hwloc_|HWLOC_)/)],
    [/^numaif?\.h$/, starting(/^(?:numa_|mbind$|set_mempolicy$|get_mempolicy$|migrate_pages$|move_pages$)/)],
    // Networking and protocols.
    [/^curl\//, starting(/^(?:curl_|CURL)/), true],
    // hiredis, its compatibility header too: `<hiredis/sdscompat.h>` makes `sdsnew` one for `hi_sdsnew`.
    [/^hiredis(?:\/|\.h$)/, starting(/^(?:redis[A-Z]|REDIS_|HIREDIS_|hi_|hisds|sds|SDS_)/)],
    [/^(?:libssh2|libssh2_\w+)\.h$/, starting(/^(?:libssh2_|LIBSSH2_)/), true],
    [/^libssh\//, starting(/^(?:ssh_|sftp_|SSH_|SFTP_)/)],
    [/^nghttp[23]\/|^ngtcp2\//, starting(/^(?:nghttp[23]_|NGHTTP[23]_|ngtcp2_|NGTCP2_)/)],
    [/^(?:ares|ares_\w+)\.h$/, starting(/^(?:ares_|ARES_)/), true],
    [/^(?:event|evhttp|evdns|evutil|evrpc)\.h$|^event2\//, starting(/^(?:event_|evbuffer_|evhttp_|evdns_|evutil_|evconnlistener_|bufferevent_|evtimer_|evsignal_|evrpc_|EV_|EVUTIL_|EVBUFFER_)/), true],
    [/^ev\.h$/, starting(/^(?:ev_|EV_)/)],
    [/^uv\.h$|^uv\//, starting(/^(?:uv_|UV_)/), true],
    [/^(?:idn2|psl|libpsl|gsasl|quiche|msh3|rustls|bearssl\w*|s2n)\.h$|^librtmp\//, starting(/^(?:idn2_|IDN2_|psl_|PSL_|gsasl_|GSASL_|quiche_|QUICHE_|Msh3|MSH3_|rustls_|RUSTLS_|br_|BR_|s2n_|S2N_|RTMP)/)],
    [/^(?:ldap|lber|ldap_\w+)\.h$/, starting(/^(?:ldap_|ber_|LDAP_|LBER_)/)],
    [/^(?:krb5|gssapi|com_err)\.h$|^(?:krb5|gssapi)\//, starting(/^(?:krb5_|KRB5_|gss_|GSS_|com_err|error_message)/)],
    [/^sasl\//, starting(/^(?:sasl_|SASL_)/)],
    [/^security\/pam_|^pam_\w+\.h$/, starting(/^(?:pam_|PAM_)/)],
    // Cryptography beyond OpenSSL and its forks.
    [/^gnutls\//, starting(/^(?:gnutls_|GNUTLS_)/)],
    [/^(?:mbedtls|psa)\//, starting(/^(?:mbedtls_|MBEDTLS_|psa_|PSA_)/)],
    [/^sodium(?:\/|\.h$)/, starting(/^(?:sodium_|crypto_|randombytes)/)],
    [/^gcrypt\.h$|^gpg-error\.h$/, starting(/^(?:gcry_|GCRY_|gpg_|GPG_)/)],
    [/^nettle\//, starting(/^(?:nettle_|aes|sha\d*_|md[245]_|hmac_|rsa_|dsa_|ecc_|ecdsa_|gcm_|ccm_|eax_|chacha|poly1305_|salsa20_|des3?_|arcfour_|arctwo_|blowfish_|camellia|cast128_|serpent_|twofish_|ripemd160_|gosthash94_|pbkdf2_|base64_|base16_|yarrow256_|knuth_lfib_|cbc_|ctr_|umac\d*_|siv_)/)],
    // Compression beyond zlib.
    [/^bzlib\.h$/, starting(/^BZ2?_/)],
    [/^lzma(?:\/|\.h$)/, starting(/^(?:lzma_|LZMA_)/)],
    [/^(?:zstd|zdict|zstd_errors)\.h$/, starting(/^(?:ZSTD_|ZDICT_|ZSTDMT_)/)],
    [/^lz4(?:hc|frame)?\.h$/, starting(/^LZ4/)],
    [/^brotli\//, starting(/^(?:Brotli|BROTLI_)/)],
    [/^(?:archive|archive_entry)\.h$/, starting(/^(?:archive_|ARCHIVE_)/)],
    // Formats, images and fonts.
    [/^libxml\/|^libxslt\/|^libexslt\//, starting(/^(?:xml[A-Z]|html[A-Z]|xslt[A-Z]|exslt[A-Z]|LIBXML_|XML_|XSLT_)/)],
    [/^expat(?:_external)?\.h$/, starting(/^XML_/)],
    [/^(?:jansson|jansson_config)\.h$|^json-c\//, starting(/^(?:json_|JSON_)/)],
    [/^(?:cjson\/)?cJSON\.h$/, starting(/^cJSON_/)],
    [/^yaml\.h$/, starting(/^(?:yaml_|YAML_)/)],
    [/^msgpack(?:\/|\.h$)/, starting(/^(?:msgpack_|MSGPACK_)/)],
    [/^(?:png|pngconf|pnglibconf)\.h$|^libpng\d*\//, starting(/^(?:png_|PNG_)/)],
    [/^(?:jpeglib|jerror|jmorecfg|turbojpeg)\.h$/, starting(/^(?:jpeg_|j[A-Z]|JPEG_|tj[A-Z]|TJ)/)],
    [/^(?:tiffio|tiff)\.h$/, starting(/^(?:TIFF|_TIFF)/)],
    [/^gif_lib\.h$/, starting(/^(?:[ED]?Gif|GIF_)/)],
    [/^webp\//, starting(/^(?:WebP|WEBP_)/)],
    [/^(?:ft2build|ftheader)\.h$|^freetype\d*\//, starting(/^(?:FT_|FTC_|ft_|FT2_)/)],
    [/^(?:hb|hb-\w+)\.h$|^harfbuzz\//, starting(/^(?:hb_|HB_)/)],
    [/^fontconfig\//, starting(/^(?:Fc[A-Z]|FC_)/)],
    [/^cairo(?:\/|\.h$|-\w+\.h$)/, starting(/^(?:cairo_|CAIRO_)/)],
    [/^pango\//, starting(/^(?:pango_|PANGO_)/)],
    // Desktop and devices.
    [/^xcb\//, starting(/^(?:xcb_|XCB_)/)],
    [/^wayland-[\w-]+\.h$/, starting(/^(?:wl_|WL_)/)],
    [/^alsa\//, starting(/^(?:snd_|SND_)/)],
    [/^pulse\//, starting(/^(?:pa_|PA_)/)],
    [/^jack\//, starting(/^(?:jack_|JACK_)/)],
    [/^(?:AL|OpenAL)\//, starting(/^(?:al[A-Z]|alc[A-Z]|AL_|ALC_)/)],
    [/^portaudio\.h$/, starting(/^(?:Pa_|pa[A-Z]|PA_)/)],
    [/^libusb(?:-[\d.]+)?(?:\/|\.h$)/, starting(/^(?:libusb_|LIBUSB_)/)],
    [/^pcap(?:\/|\.h$)/, starting(/^(?:pcap_|PCAP_)/)],
    [/^dbus\//, starting(/^(?:dbus_|DBUS_)/)],
    [/^(?:netlink|libnl\d*)\//, starting(/^(?:nl_|nla_|nlmsg_|genl|NL_|NLA_|NLMSG_)/)],
    [/^libmnl\//, starting(/^(?:mnl_|MNL_)/)],
    [/^systemd\//, starting(/^(?:sd_|SD_)/)],
    [/^selinux\//, starting(/^(?:selinux_|security_|is_selinux|freecon|getcon|setcon|getfilecon|setfilecon|lgetfilecon|fgetfilecon|context_)/)],
    [/^seccomp\.h$/, starting(/^(?:seccomp_|SCMP_)/)],
    [/^(?:uuid\/uuid|uuid)\.h$/, starting(/^uuid_/)],
    [/^blkid\//, starting(/^blkid_/)],
    // Embedded and old platforms' stacks: lwIP (its sockets are the POSIX names, reserved), AmigaOS (its libraries' calls, inline macros of capitalized names), NonStop's FLOSS.
    [/^lwip\//, starting(/^(?:lwip_|LWIP_)/)],
    [/^(?:exec|proto|dos|clib|inline|libraries|devices|intuition|graphics|utility|workbench)\//, capitalized, true],
    [/^floss\.h$/, starting(/^(?:floss_|FLOSS_)/)],
    // Tools' libraries: libunwind, elfutils, BFD, Capstone, libffi, readline and editline, emscripten, JNI.
    [/^libunwind(?:-[\w-]+)?\.h$/, starting(/^(?:unw_|_U[A-Z_]|UNW_)/)],
    [/^(?:libelf|gelf|libdwarf|dwarf|libdw)\.h$|^elfutils\//, starting(/^(?:elf_|gelf_|elf32_|elf64_|dw[a-z_]|dwarf_|dwfl_|DW_|ELF_C_)/)],
    [/^bfd\.h$/, starting(/^(?:bfd_|BFD_)/)],
    [/^capstone\//, starting(/^(?:cs_|CS_)/)],
    [/^ffi(?:target)?\.h$/, starting(/^(?:ffi_|FFI_)/)],
    [/^(?:readline|editline)\/|^histedit\.h$/, (n) => /^(?:rl_|el_|history_|RL_|EL_)/.test(n) || /^(?:readline|add_history|read_history|write_history|using_history|stifle_history|clear_history|where_history|current_history|remove_history|history)$/.test(n)],
    [/^emscripten(?:\/|\.h$)/, starting(/^(?:emscripten_|EM_)/)],
    [/^jni(?:_md)?\.h$/, starting(/^(?:JNI_|Jni)/)],
    // Test frameworks whose checks are macros of lower-case names.
    [/^cmocka(?:_pbc)?\.h$/, starting(/^(?:assert_|will_return|expect_|mock|check_expected|cmocka_|fail$|fail_msg$|skip$|print_message$|print_error$|unit_test|run_test|_assert|_will_return|_expect|_check_expected|_mock)/)],
    [/^check\.h$/, starting(/^(?:ck_|fail|mark_point$|tcase_|suite_|srunner_|START_TEST$|END_TEST$)/)],
    [/^CUnit\//, starting(/^CU_/)],
    [/^criterion\//, starting(/^(?:cr_|Test$|ParameterizedTest$|Theory$)/)],
];

/** A header's names by its file's and folders' own: `GL/glew.h` gives `gl` and `glew`, `libssh2.h` gives `libssh2` and `ssh2`. */
const stemsOf = (spec: string): string[] =>
    spec
        .replace(/\.[^./]+$/, "")
        .split("/")
        .flatMap((seg) => {
            const s = seg.toLowerCase().replace(/[-.]?\d+(?:\.\d+)*$/, "");
            return s.startsWith("lib") && s.length > 4 ? [s, s.slice(3)] : [s];
        })
        .filter((s) => s.length >= 2 && /^[a-z]/.test(s));

/** What a header, included as `spec`, may define as macros, read once: the table's entries for it, and its stems. */
const known = new Map<string, { listed: typeof SYSTEM_MACROS; stems: string[] }>();
const entryOf = (spec: string) => {
    let e = known.get(spec);
    if (!e) known.set(spec, (e = { listed: SYSTEM_MACROS.filter(([header]) => header.test(spec)), stems: stemsOf(spec) }));
    return e;
};

/** Whether a header outside the repository may define macros of ordinary names at all: the table lists it, or a branch says it is a library's (`lenient`). */
export const definesMacros = (spec: string, lenient = false): boolean => lenient || entryOf(spec).listed.length > 0 || /compat[^/]*$/i.test(spec);

/**
 * Whether a header outside the repository, included as `spec`, may define a
 * macro of the name: one the table lists, the names it gives, and where it
 * includes `<windows.h>` on Windows (libcurl's, libuv's), the capitalized
 * ones too. One the table doesn't list, included where a branch says it is a
 * library's (`lenient`: `#ifdef USE_GLEW` / `#include <GL/glew.h>`), may
 * define the names that start as its file or a folder of its path is named
 * (`glCreateShader`, `<foo/foo.h>`'s `foo_open`), and may pull in
 * `<windows.h>`: the capitalized names too. One the table doesn't list whose
 * file is named for compatibility (`compat`) exists to rename: any name.
 */
export const systemMacro = (spec: string, name: string, lenient = false): boolean => {
    const { listed, stems } = entryOf(spec);
    if (listed.some(([, names, windows]) => names(name) || (windows && capitalized(name)))) return true;
    if (listed.length > 0) return false;
    if (/compat[^/]*$/i.test(spec)) return true;
    if (!lenient) return false;
    return capitalized(name) || stems.some((s) => name.length > s.length && name.toLowerCase().startsWith(s) && /[A-Z0-9_]/.test(name[s.length]));
};
