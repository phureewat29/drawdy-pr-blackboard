/**
 * Library supertypes whose members are known, so a class that extends one
 * still has a known member list: Kotlin's view of their JDK and standard
 * library declarations (methods, the properties their getters give, and the
 * default imports' extensions of them). By the name the default imports
 * give, or the fully qualified name an import gives.
 */

const THROWABLE = "message cause localizedMessage stackTrace suppressed fillInStackTrace getLocalizedMessage getMessage getCause getStackTrace setStackTrace getSuppressed addSuppressed initCause printStackTrace stackTraceToString suppressedExceptions";
const CLOSEABLE = "close closeFinally use";

/** Member names by type: the default imports' names, then imported ones by fully qualified name. */
export const LIB_MEMBERS: ReadonlyMap<string, string> = new Map([
    ...["Throwable", "Exception", "RuntimeException", "Error", "IllegalStateException", "IllegalArgumentException", "UnsupportedOperationException", "IndexOutOfBoundsException", "NoSuchElementException", "NullPointerException", "ClassCastException", "ArithmeticException", "NumberFormatException", "ConcurrentModificationException", "AssertionError", "NotImplementedError", "InterruptedException", "java.io.IOException", "java.io.EOFException", "java.io.FileNotFoundException", "java.io.InterruptedIOException", "java.io.UncheckedIOException", "java.net.ProtocolException", "java.net.SocketException", "java.net.SocketTimeoutException", "java.net.UnknownHostException", "java.net.UnknownServiceException", "java.util.concurrent.CancellationException", "java.util.concurrent.TimeoutException", "java.util.concurrent.ExecutionException", "kotlin.coroutines.cancellation.CancellationException"].map((n) => [n, THROWABLE] as [string, string]),
    ["AutoCloseable", CLOSEABLE],
    ["java.io.Closeable", CLOSEABLE],
    ["java.lang.AutoCloseable", CLOSEABLE],
    ["java.io.Flushable", "flush"],
    ["Cloneable", "clone"],
    ["Runnable", "run"],
    ["java.lang.Runnable", "run"],
    ["java.util.concurrent.Callable", "call"],
    ["Comparable", "compareTo coerceAtLeast coerceAtMost coerceIn rangeTo rangeUntil"],
    ["java.io.Serializable", ""],
    ["java.util.EventListener", ""],
    ["kotlinx.coroutines.CoroutineScope", "coroutineContext"],
]);

/**
 * Library packages a star import may name whose public declarations are
 * known (kotlin.test, kotlinx.coroutines 1.x and the standard library's
 * packages beyond the default imports, as kotlinc 2.4.21 ships them): none
 * extends a type parameter or `Any`, so none extends a class of the
 * repository that has no library supertype; LIB_NAMES lists their public
 * top-level functions, properties and classes. A JDK package (java., javax.)
 * holds classes alone, each named with a capital.
 */
export const LIB_STARS: ReadonlySet<string> = new Set("kotlin.concurrent kotlin.concurrent.atomics kotlin.contracts kotlin.coroutines kotlin.coroutines.cancellation kotlin.coroutines.intrinsics kotlin.enums kotlin.experimental kotlin.io.encoding kotlin.io.path kotlin.math kotlin.properties kotlin.random kotlin.reflect kotlin.streams kotlin.system kotlin.test kotlin.time kotlin.uuid kotlinx.coroutines kotlinx.coroutines.channels kotlinx.coroutines.debug kotlinx.coroutines.flow kotlinx.coroutines.future kotlinx.coroutines.intrinsics kotlinx.coroutines.selects kotlinx.coroutines.stream kotlinx.coroutines.sync kotlinx.coroutines.time".split(" "));

export const LIB_NAMES: ReadonlySet<string> = new Set("AbstractCoroutine AbstractCoroutineContextElement AbstractCoroutineContextKey AbstractDoubleTimeSource AbstractFlow AbstractLongTimeSource ActorScope Asserter AsserterContributor AtomicArray AtomicBoolean AtomicInt AtomicIntArray AtomicLong AtomicLongArray AtomicReference Base64 BroadcastChannel BufferOverflow COROUTINE_SUSPENDED CallsInPlace CancellableContinuation CancellationException Channel ChannelIterator ChannelResult ChildHandle ChildJob Clock CloseableCoroutineDispatcher ClosedReceiveChannelException ClosedSendChannelException ComparableTimeMark CompletableDeferred CompletableJob CompletionHandler CompletionHandlerException ConditionalEffect ConflatedBroadcastChannel Continuation ContinuationInterceptor ContractBuilder CopyActionContext CopyActionResult CopyableThreadContextElement CopyableThrowable CoroutineContext CoroutineDispatcher CoroutineExceptionHandler CoroutineName CoroutineScope CoroutineStart DEBUG_PROPERTY_NAME DEBUG_PROPERTY_VALUE_AUTO DEBUG_PROPERTY_VALUE_OFF DEBUG_PROPERTY_VALUE_ON DEFAULT_CONCURRENCY DEFAULT_CONCURRENCY_PROPERTY_NAME DefaultAsserter Deferred Delay Delegates DelicateCoroutinesApi Dispatchers DisposableHandle Duration DurationUnit E Effect EmptyCoroutineContext EnumEntries ExecutorCoroutineDispatcher ExpectRefinement ExperimentalAtomicApi ExperimentalContracts ExperimentalCoroutinesApi ExperimentalEncodingApi ExperimentalExtendedContracts ExperimentalKotlinTestApi ExperimentalNativeApi ExperimentalObjCEnum ExperimentalObjCName ExperimentalObjCRefinement ExperimentalPathApi ExperimentalStdlibCoroutineSupportApi ExperimentalTime ExperimentalTypeInference ExperimentalUuidApi FileVisitorBuilder Flow FlowCollector FlowPreview GlobalScope HoldsIn IO_PARALLELISM_PROPERTY_NAME Instant InternalCoroutinesApi InvocationKind Job Job0 JobSupport KAnnotatedElement KCallable KClass KClassifier KDeclarationContainer KFunction KMutableProperty KMutableProperty0 KMutableProperty1 KMutableProperty2 KParameter KProperty KProperty0 KProperty1 KProperty2 KType KTypeParameter KTypeProjection KVariance KVisibility MainCoroutineDispatcher MainScope MutableSharedFlow MutableStateFlow Mutex NonCancellable NonDisposableHandle ObservableProperty ObsoleteCoroutinesApi OnCancellationConstructor OnErrorResult PI ParentJob Path PathWalkOption ProcessResultFunction ProducerScope PropertyDelegateProvider Random ReadOnlyProperty ReadWriteProperty ReceiveChannel RegistrationFunction RestrictsSuspension Returns ReturnsNotNull Runnable SelectBuilder SelectClause SelectClause0 SelectClause1 SelectClause2 SelectInstance Semaphore SendChannel SharedFlow SharingCommand SharingStarted SimpleEffect StateFlow SupervisorJob SupervisorJob0 TestTimeSource ThreadContextElement TickerMode TimeMark TimeSource TimedValue TimeoutCancellationException Uuid Volatile abs acos acosh asin asinh assertContains assertContentEquals assertEquals assertFails assertFailsWith assertFalse assertIs assertIsNot assertNotEquals assertNotNull assertNotSame assertNull assertSame assertTrue asserter atan atan2 atanh atomicArrayOfNulls awaitAll awaitCancellation callbackFlow cbrt ceil channelFlow combine combineTransform contract coroutineContext coroutineScope cos cosh createTempDirectory createTempFile currentCoroutineContext currentStackTrace delay emptyFlow enumEntries exitProcess exp expect expm1 fail fileVisitor fixedRateTimer floor flow flowOf handleCoroutineException hypot joinAll ln ln1p log log10 log2 max measureNanoTime measureTime measureTimeMillis measureTimedValue merge min newFixedThreadPoolContext newSingleThreadContext processNextEventInCurrentThread round runBlocking runInterruptible select selectUnbiased sign sin sinh sqrt supervisorScope suspendCancellableCoroutine suspendCoroutine suspendCoroutineUninterceptedOrReturn tan tanh thread ticker timer timerTask todo truncate typeOf whileSelect withContext withTimeout withTimeoutOrNull yield".split(" "));
