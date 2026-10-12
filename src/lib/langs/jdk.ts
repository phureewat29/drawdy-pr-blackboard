/**
 * The JDK's types that classes most often extend or implement, with their
 * supertypes: what Java's resolver needs to know a class's members when its
 * chain runs through the JDK (`java.ts`). Generated from JDK 21.0.12.1 by
 * reflection (public and protected members; a method overriding one of its
 * supertypes' of the same parameter types left out). One type a line:
 * `fqn|kind|supertypes|methods|fields|member types`. The kind is `c` or
 * `i`, or `C` or `I` for a type listed for its supertypes alone, whose
 * members are not known. A method is `name(types)` after `s:` (static),
 * `p:` (protected) and `a:` (abstract), `...` closing varargs, `?` a
 * type variable; `!n` stands for the nth name of `JDK_ALIASES` and `@n.`
 * for the nth package of `JDK_PACKAGES`.
 */

export const JDK_PACKAGES = ["java.lang","java.util.function","java.util","java.io","java.util.concurrent","java.net","javax.lang.model.util","javax.net.ssl","javax.tools","java.lang.reflect","java.time.temporal","java.security","javax.lang.model.element","java.nio","java.util.concurrent.locks","java.lang.constant","javax.lang.model.type","java.nio.channels","java.util.logging","java.security.cert","java.lang.ref","java.nio.file","java.lang.invoke","javax.annotation.processing","java.util.concurrent.atomic","javax.security.auth","java.util.random","java.util.stream","javax.management","java.beans","java.nio.charset","java.time","java.math","java.nio.file.attribute","java.lang.annotation","java.lang.instrument","java.time.format","java.util.zip"];

export const JDK_ALIASES = ["@0.String","@0.Object","@3.Serializable","@8.JavaFileManager.Location","@0.RuntimeException","@1.Function","@4.CompletionStage","@0.Runnable","@1.BiFunction","@4.TimeUnit","@d.ByteBuffer","@2.Collection","@0.Comparable","@4.Executor","@0.ReflectiveOperationException","@1.Consumer","@0.Cloneable","@3.IOException","@0.CharSequence","@0.Throwable","@e.AbstractQueuedSynchronizer.ConditionObject","@3.OutputStream","@1.BiConsumer","@0.IncompatibleClassChangeError","@1.LongBinaryOperator","@0.Exception","@0.Class","@f.Constable","@2.Comparator","@1.IntBinaryOperator","@j.X509Certificate","@2.AbstractCollection","@0.LinkageError","@8.FileObject","@1.DoubleBinaryOperator","@a.TemporalAccessor","@1.ToDoubleFunction","@2.AbstractMap","@0.VirtualMachineError","@5.URL","@7.ManagerFactoryParameters","@4.ForkJoinTask","@0.Thread.UncaughtExceptionHandler","@1.ToLongFunction","@1.LongUnaryOperator","@0.Number","@0.ClassLoader","@3.Closeable","@a.TemporalField","@2.AbstractQueue","@1.ToIntFunction","@9.AnnotatedElement","@1.IntUnaryOperator","@2.Locale","@f.ConstantDesc","@5.Authenticator.RequestorType","@a.TemporalUnit","@1.Supplier","@a.Temporal","@2.SequencedCollection","@8.JavaFileObject.Kind","@1.BinaryOperator","@3.InputStream","@0.IndexOutOfBoundsException","@b.Principal","@e.Condition","@0.IllegalArgumentException","@0.AutoCloseable","@4.BlockingQueue","@0.Appendable","@4.RunnableScheduledFuture","@6.AbstractElementVisitor6","@4.Callable","@b.ProtectionDomain","@9.AccessibleObject","@2.ResourceBundle.Control","@3.Writer","@3.ObjectStreamConstants","@0.AbstractStringBuilder","@0.Thread","@2.Map.Entry","@5.InetAddress","@2.AbstractSet","@c.Element","@6.AbstractAnnotationValueVisitor6","@8.JavaFileObject","@h.ReadableByteChannel","@h.WritableByteChannel","@2.Map","@1.DoubleUnaryOperator","@g.TypeMirror","@1.UnaryOperator","@6.SimpleAnnotationValueVisitor9","@6.SimpleAnnotationValueVisitor6","@6.SimpleAnnotationValueVisitor7","@6.SimpleAnnotationValueVisitor8","@3.FilterOutputStream","@9.GenericDeclaration","@4.ThreadPoolExecutor","@2.AbstractList","@2.RandomAccess","@1.Predicate","@4.CompletableFuture","@e.AbstractOwnableSynchronizer","@i.LogRecord","@7.SSLEngine","@4.CountedCompleter","@r.Collector.Characteristics","@3.Reader","@5.SocketException","@b.GeneralSecurityException","@q.RandomGenerator","@4.ExecutorService","@4.Flow.Subscriber","@4.RejectedExecutionHandler","@4.ScheduledExecutorService","@1.DoublePredicate","@c.AnnotationValue","@4.AbstractExecutorService","@3.FilenameFilter","@a.TemporalAmount","@2.ResourceBundle","@4.RunnableFuture","@3.InterruptedIOException","@m.TypeDescriptor.OfField","@2.AbstractSequentialList","@4.ConcurrentNavigableMap","@c.AnnotationValueVisitor","@7.SSLSessionBindingEvent","@2.List","@2.EventListener","@3.Flushable","@0.IllegalStateException","@k.Reference","@5.Authenticator","@b.PublicKey","@4.ConcurrentMap","@1.LongPredicate","@6.SimpleElementVisitor9","@6.SimpleElementVisitor6","@6.SimpleElementVisitor7","@6.SimpleElementVisitor8","@6.AbstractTypeVisitor6","@3.ObjectOutput","@2.SequencedMap","@2.SequencedSet","@2.NavigableMap","@2.NavigableSet","@4.Future","@1.IntPredicate","@7.TrustManager","@x.BasicFileAttributes","@b.KeyStore","@3.ObjectInput","@3.File","@3.PrintStream","@3.PrintWriter","@9.Type","@2.Set","@1.BiPredicate","@6.SimpleTypeVisitor9","@6.SimpleTypeVisitor6","@6.SimpleTypeVisitor7","@6.SimpleTypeVisitor8","@3.FilterInputStream","@3.ObjectStreamClass","@h.Channel","@2.Queue","@2.Deque","@4.Flow.Subscription","@c.ExecutableElement","@9.Executable","@7.SSLSession","@7.KeyManager","@0.ClassFormatError","@a.TemporalAdjuster","@c.AnnotationMirror","@7.X509TrustManager","@1.ToIntBiFunction","@4.ScheduledFuture","@c.VariableElement","@6.ElementScanner9","@6.ElementScanner6","@6.ElementScanner7","@6.ElementScanner8","@5.Socket","@8.JavaFileManager","@m.TypeDescriptor","@4.Flow.Publisher","@1.DoubleConsumer","@c.ElementVisitor","@7.X509KeyManager","@0.Iterable","@b.Provider","@2.Iterator","@0.Error","@5.URLConnection","@5.ProxySelector","@5.SocketAddress","@j.X509Extension","@4.BlockingDeque","@4.ThreadFactory","@e.ReadWriteLock","@8.OptionChecker","@0.StringBuffer","@1.LongConsumer","@i.Handler","@7.SSLException","@0.ThreadLocal","@h.ByteChannel","@l.FileVisitor","@p.Destroyable","@j.Certificate","@1.IntFunction","@2.Spliterator","@1.IntConsumer","@g.TypeVisitor","@0.Module","@9.Member","@9.Method","@3.DataOutput","@3.FileFilter","@2.Dictionary","@3.DataInput","@2.Hashtable","@2.SortedMap","@2.SortedSet","@i.Formatter","@n.Processor","@0.Readable","@v.Duration","@u.Charset","@2.HashMap","@2.HashSet","@4.Delayed"];

export const JDK_TYPES = String.raw`@t.PropertyChangeListener|i|!3m|a:propertyChange(@t.PropertyChangeEvent)||
@3.BufferedInputStream|c|!4k||buf count marklimit markpos pos|
@3.BufferedOutputStream|c|!2o||buf count|
@3.BufferedReader|c|!30|lines() readLine()||
@3.BufferedWriter|c|!24|newLine()||
@3.ByteArrayInputStream|c|!1q||buf count mark pos|
@3.ByteArrayOutputStream|c|!l|reset() size() toByteArray() toString(int) toString(!0) toString(!6f) writeBytes(byte[]) writeTo(!l)|buf count|
!1b|i|!1v|||
!67|i||a:readBoolean() a:readByte() a:readChar() a:readDouble() a:readFloat() a:readFully(byte[]) a:readFully(byte[],int,int) a:readInt() a:readLine() a:readLong() a:readShort() a:readUTF() a:readUnsignedByte() a:readUnsignedShort() a:skipBytes(int)||
!64|i||a:write(byte[]) a:write(byte[],int,int) a:write(int) a:writeBoolean(boolean) a:writeByte(int) a:writeBytes(!0) a:writeChar(int) a:writeChars(!0) a:writeDouble(double) a:writeFloat(float) a:writeInt(int) a:writeLong(long) a:writeShort(int) a:writeUTF(!0)||
@3.EOFException|c|!h|||
@3.Externalizable|i|!2|a:readExternal(!49) a:writeExternal(!3z)||
!65|i||a:accept(!4a)||
@3.FileNotFoundException|c|!h|||
!3b|i||a:accept(!4a,!0)||
!4a|c|!1,!2,!c|canExecute() canRead() canWrite() compareTo(!4a) createNewFile() delete() deleteOnExit() exists() getAbsoluteFile() getAbsolutePath() getCanonicalFile() getCanonicalPath() getFreeSpace() getName() getParent() getParentFile() getPath() getTotalSpace() getUsableSpace() isAbsolute() isDirectory() isFile() isHidden() lastModified() length() list() list(!3b) listFiles() listFiles(!65) listFiles(!3b) mkdir() mkdirs() renameTo(!4a) s:createTempFile(!0,!0) s:createTempFile(!0,!0,!4a) s:listRoots() setExecutable(boolean) setExecutable(boolean,boolean) setLastModified(long) setReadOnly() setReadable(boolean) setReadable(boolean,boolean) setWritable(boolean) setWritable(boolean,boolean) toPath() toURI() toURL()|pathSeparator pathSeparatorChar separator separatorChar|
!4k|c|!1q||in|
!2o|c|!l||out|
@3.FilterReader|c|!30||in|
@3.FilterWriter|c|!24||out|
!3n|i||a:flush()||
!h|c|!p|||
@3.InputStreamReader|c|!30|getEncoding()||
!1q|c|!1,!1b|a:read() available() mark(int) markSupported() read(byte[]) read(byte[],int,int) readAllBytes() readNBytes(byte[],int,int) readNBytes(int) reset() s:nullInputStream() skip(long) skipNBytes(long) transferTo(!l)||
!3f|c|!h||bytesTransferred|
@3.ObjectInputStream|c|!1q,!49,!25|defaultReadObject() getObjectInputFilter() p:enableResolveObject(boolean) p:readClassDescriptor() p:readObjectOverride() p:readStreamHeader() p:resolveClass(!4l) p:resolveObject(!1) p:resolveProxyClass(!0[]) readFields() readUnshared() registerValidation(@3.ObjectInputValidation,int) setObjectInputFilter(@3.ObjectInputFilter)||GetField
!49|i|!67,!1v|a:available() a:read() a:read(byte[]) a:read(byte[],int,int) a:readObject() a:skip(long)||
@3.ObjectOutputStream|c|!l,!3z,!25|defaultWriteObject() p:annotateClass(!q) p:annotateProxyClass(!q) p:drain() p:enableReplaceObject(boolean) p:replaceObject(!1) p:writeClassDescriptor(!4l) p:writeObjectOverride(!1) p:writeStreamHeader() putFields() reset() useProtocolVersion(int) writeFields() writeUnshared(!1)||PutField
!3z|i|!64,!1v|a:flush() a:writeObject(!1)||
!25|i|||PROTOCOL_VERSION_1 PROTOCOL_VERSION_2 SC_BLOCK_DATA SC_ENUM SC_EXTERNALIZABLE SC_SERIALIZABLE SC_WRITE_METHOD SERIAL_FILTER_PERMISSION STREAM_MAGIC STREAM_VERSION SUBCLASS_IMPLEMENTATION_PERMISSION SUBSTITUTION_PERMISSION TC_ARRAY TC_BASE TC_BLOCKDATA TC_BLOCKDATALONG TC_CLASS TC_CLASSDESC TC_ENDBLOCKDATA TC_ENUM TC_EXCEPTION TC_LONGSTRING TC_MAX TC_NULL TC_OBJECT TC_PROXYCLASSDESC TC_REFERENCE TC_RESET TC_STRING baseWireHandle|
@3.OutputStreamWriter|c|!24|getEncoding()||
!l|c|!1,!1b,!3n|a:write(int) s:nullOutputStream() write(byte[]) write(byte[],int,int)||
!4b|c|!2o,!1x,!1b|charset() checkError() format(!0,!1[]...) format(!1h,!0,!1[]...) p:clearError() p:setError() print(boolean) print(char) print(char[]) print(double) print(float) print(int) print(!1) print(!0) print(long) printf(!0,!1[]...) printf(!1h,!0,!1[]...) println() println(boolean) println(char) println(char[]) println(double) println(float) println(int) println(!1) println(!0) println(long) writeBytes(byte[])||
!4c|c|!24|checkError() format(!0,!1[]...) format(!1h,!0,!1[]...) p:clearError() p:setError() print(boolean) print(char) print(char[]) print(double) print(float) print(int) print(!1) print(!0) print(long) printf(!0,!1[]...) printf(!1h,!0,!1[]...) println() println(boolean) println(char) println(char[]) println(double) println(float) println(int) println(!1) println(!0) println(long)|out|
!30|c|!1,!6d,!1b|a:read(char[],int,int) mark(int) markSupported() read() read(char[]) ready() reset() s:nullReader() skip(long) transferTo(!24)|lock|
!2|i||||
@3.StringReader|c|!30|||
@3.StringWriter|c|!24|getBuffer()||
@3.UncheckedIOException|c|!4|||
@3.UnsupportedEncodingException|c|!h|||
!24|c|!1,!1x,!1b,!3n|a:write(char[],int,int) s:nullWriter() write(char[]) write(int) write(!0) write(!0,int,int)|lock|
@0.AbstractMethodError|c|!n|||
!26|c|!1,!1x,!i|append(boolean) append(char[]) append(char[],int,int) append(double) append(float) append(int) append(!1) append(!0) append(!5o) append(long) appendCodePoint(int) capacity() codePointAt(int) codePointBefore(int) codePointCount(int,int) delete(int,int) deleteCharAt(int) ensureCapacity(int) getChars(int,int,char[],int) indexOf(!0) indexOf(!0,int) insert(int,boolean) insert(int,char) insert(int,char[]) insert(int,char[],int,int) insert(int,double) insert(int,float) insert(int,int) insert(int,!i) insert(int,!i,int,int) insert(int,!1) insert(int,!0) insert(int,long) lastIndexOf(!0) lastIndexOf(!0,int) offsetByCodePoints(int,int) repeat(int,int) repeat(!i,int) replace(int,int,!0) reverse() setCharAt(int,char) setLength(int) substring(int) substring(int,int) trimToSize()||
!1x|i||a:append(char) a:append(!i) a:append(!i,int,int)||
@0.ArithmeticException|c|!4|||
@0.ArrayIndexOutOfBoundsException|c|!1r|||
@0.ArrayStoreException|c|!4|||
@0.AssertionError|c|!5f|||
!1v|i||a:close()||
@0.Boolean|C|!1,!2,!c,!r|||
@0.BootstrapMethodError|c|!w|||
@0.Byte|C|!19,!c,!r|||
!i|i||a:charAt(int) a:length() a:subSequence(int,int) a:toString() chars() codePoints() isEmpty() s:compare(!i,!i)||
@0.Character|C|!1,!2,!c,!r|||
@0.ClassCastException|c|!4|||
!4u|c|!w|||
!1a|c|!1|clearAssertionStatus() getDefinedPackage(!0) getDefinedPackages() getName() getParent() getResource(!0) getResourceAsStream(!0) getResources(!0) getUnnamedModule() isRegisteredAsParallelCapable() loadClass(!0) p:defineClass(byte[],int,int) p:defineClass(!0,byte[],int,int) p:defineClass(!0,byte[],int,int,!21) p:defineClass(!0,!a,!21) p:definePackage(!0,!0,!0,!0,!0,!0,!0,!13) p:findClass(!0) p:findClass(!0,!0) p:findLibrary(!0) p:findLoadedClass(!0) p:findResource(!0) p:findResource(!0,!0) p:findResources(!0) p:findSystemClass(!0) p:getClassLoadingLock(!0) p:getPackage(!0) p:getPackages() p:loadClass(!0,boolean) p:resolveClass(!q) p:setSigners(!q,!1[]) resources(!0) s:getPlatformClassLoader() s:getSystemClassLoader() s:getSystemResource(!0) s:getSystemResourceAsStream(!0) s:getSystemResources(!0) s:p:registerAsParallelCapable() setClassAssertionStatus(!0,boolean) setDefaultAssertionStatus(boolean) setPackageAssertionStatus(!0,boolean)||
@0.ClassNotFoundException|c|!e|getException()||
@0.ClassValue|c|!1|get(!q) p:a:computeValue(!q) remove(!q)||
!q|C|!1,!2,!2p,!4d,!1f,!3g,!r|||
@0.CloneNotSupportedException|c|!p|||
!g|i||||
!c|i||a:compareTo(?)||
@0.Double|C|!19,!c,!r,!1i|||
@0.EnumConstantNotPresentException|c|!4|constantName() enumType()||
@0.Enum|c|!1,!r,!c,!2|getDeclaringClass() name() ordinal() s:valueOf(!q,!0)||EnumDesc
!5f|c|!j|||
@0.ExceptionInInitializerError|c|!w|getException()||
!p|c|!j|||
@0.Float|C|!19,!c,!r,!1i|||
@0.IllegalAccessError|c|!n|||
@0.IllegalAccessException|c|!e|||
!1u|c|!4|||
@0.IllegalCallerException|c|!4|||
@0.IllegalMonitorStateException|c|!4|||
!3o|c|!4|||
@0.IllegalThreadStateException|c|!1u|||
!n|c|!w|||
!1r|c|!4|||
@0.InheritableThreadLocal|c|!5s|p:childValue(?)||
@0.InstantiationException|c|!e|||
@0.Integer|C|!19,!c,!r,!1i|||
@0.InternalError|c|!12|||
@0.InterruptedException|c|!p|||
!5c|i||a:iterator() forEach(!f) spliterator()||
!w|c|!5f|||
@0.Long|C|!19,!c,!r,!1i|||
@0.NegativeArraySizeException|c|!4|||
@0.NoClassDefFoundError|c|!w|||
@0.NoSuchFieldError|c|!n|||
@0.NoSuchFieldException|c|!e|||
@0.NoSuchMethodError|c|!n|||
@0.NoSuchMethodException|c|!e|||
@0.NullPointerException|c|!4|||
@0.NumberFormatException|c|!1u|||
!19|c|!1,!2|a:doubleValue() a:floatValue() a:intValue() a:longValue() byteValue() shortValue()||
!1|c||equals(!1) getClass() hashCode() notify() notifyAll() p:clone() p:finalize() toString() wait() wait(long) wait(long,int)||
@0.OutOfMemoryError|c|!12|||
!6d|i||a:read(@d.CharBuffer)||
@0.Record|c|!1|||
!e|c|!p|||
!7|i||a:run()||
!4|c|!p|||
@0.SecurityException|c|!4|||
@0.Short|C|!19,!c,!r|||
@0.StackOverflowError|c|!12|||
!5o|C|!26,!1x,!2,!c,!i|||
@0.StringBuilder|C|!26,!1x,!2,!c,!i|||
@0.StringIndexOutOfBoundsException|c|!1r|||
!0|C|!1,!2,!c,!i,!r,!1i|||
!16|i||a:uncaughtException(!27,!j)||
!5s|c|!1|get() p:initialValue() remove() s:withInitial(!1l) set(?)||
!27|c|!1,!7|checkAccess() countStackFrames() getContextClassLoader() getId() getName() getPriority() getStackTrace() getState() getThreadGroup() getUncaughtExceptionHandler() interrupt() isAlive() isDaemon() isInterrupted() isVirtual() join() join(!6e) join(long) join(long,int) resume() s:activeCount() s:currentThread() s:dumpStack() s:enumerate(!27[]) s:getAllStackTraces() s:getDefaultUncaughtExceptionHandler() s:holdsLock(!1) s:interrupted() s:ofPlatform() s:ofVirtual() s:onSpinWait() s:setDefaultUncaughtExceptionHandler(!16) s:sleep(!6e) s:sleep(long) s:sleep(long,int) s:startVirtualThread(!7) s:yield() setContextClassLoader(!1a) setDaemon(boolean) setName(!0) setPriority(int) setUncaughtExceptionHandler(!16) start() stop() suspend() threadId()|MAX_PRIORITY MIN_PRIORITY NORM_PRIORITY|Builder State UncaughtExceptionHandler
!j|c|!1,!2|addSuppressed(!j) fillInStackTrace() getCause() getLocalizedMessage() getMessage() getStackTrace() getSuppressed() initCause(!j) printStackTrace() printStackTrace(!4b) printStackTrace(!4c) setStackTrace(@0.StackTraceElement[])||
@0.TypeNotPresentException|c|!4|typeName()||
@0.UnknownError|c|!12|||
@0.UnsatisfiedLinkError|c|!w|||
@0.UnsupportedClassVersionError|c|!4u|||
@0.UnsupportedOperationException|c|!4|||
@0.VerifyError|c|!w|||
!12|c|!5f|||
@y.Annotation|i||a:annotationType() a:equals(!1) a:hashCode() a:toString()||
!r|i||a:describeConstable()||
!1i|i||a:resolveConstantDesc(@m.MethodHandles.Lookup)||
@z.ClassFileTransformer|i||transform(!1a,!0,!q,!21,byte[]) transform(!61,!1a,!0,!q,!21,byte[])||
!3g|i|!57|a:arrayType() a:componentType() a:isArray() a:isPrimitive()||
!57|i||a:descriptorString()||OfField OfMethod
@k.PhantomReference|c|!3p|||
@k.ReferenceQueue|c|!1|poll() remove() remove(long)||
!3p|c|!1|clear() enqueue() get() isEnqueued() refersTo(?) s:reachabilityFence(!1)||
@k.SoftReference|c|!3p|||
@k.WeakReference|c|!3p|||
!22|c|!1,!1f|canAccess(!1) isAccessible() s:setAccessible(!22[],boolean) setAccessible(boolean) trySetAccessible()||
!1f|i||a:getAnnotation(!q) a:getAnnotations() a:getDeclaredAnnotations() getAnnotationsByType(!q) getDeclaredAnnotation(!q) getDeclaredAnnotationsByType(!q) isAnnotationPresent(!q)||
@9.Constructor|C|!4r|||
!4r|c|!22,!62,!2p|a:getAnnotatedReturnType() a:getExceptionTypes() a:getParameterAnnotations() a:getParameterCount() a:getParameterTypes() a:toGenericString() getAnnotatedExceptionTypes() getAnnotatedParameterTypes() getAnnotatedReceiverType() getGenericExceptionTypes() getGenericParameterTypes() getParameters() isVarArgs()||
@9.Field|C|!22,!62|||
@9.GenericArrayType|i|!4d|a:getGenericComponentType()||
!2p|i|!1f|a:getTypeParameters()||
@9.InvocationHandler|i||a:invoke(!1,!63,!1[]) s:invokeDefault(!1,!63,!1[]...)||
@9.InvocationTargetException|c|!e|getTargetException()||
!62|i||a:getDeclaringClass() a:getModifiers() a:getName() a:isSynthetic() accessFlags()|DECLARED PUBLIC|
!63|C|!4r|||
@9.ParameterizedType|i|!4d|a:getActualTypeArguments() a:getOwnerType() a:getRawType()||
@9.TypeVariable|i|!4d,!1f|a:getAnnotatedBounds() a:getBounds() a:getGenericDeclaration() a:getName()||
!4d|i||getTypeName()||
@9.UndeclaredThrowableException|c|!4|getUndeclaredThrowable()||
@9.WildcardType|i|!4d|a:getLowerBounds() a:getUpperBounds()||
@w.BigDecimal|C|!19,!c|||
@w.BigInteger|C|!19,!c|||
!3q|c|!1|p:getPasswordAuthentication() p:getRequestingHost() p:getRequestingPort() p:getRequestingPrompt() p:getRequestingProtocol() p:getRequestingScheme() p:getRequestingSite() p:getRequestingURL() p:getRequestorType() requestPasswordAuthenticationInstance(!0,!29,int,!0,!0,!0,!13,!1j) s:getDefault() s:requestPasswordAuthentication(!0,!29,int,!0,!0,!0) s:requestPasswordAuthentication(!0,!29,int,!0,!0,!0,!13,!1j) s:requestPasswordAuthentication(!3q,!0,!29,int,!0,!0,!0,!13,!1j) s:requestPasswordAuthentication(!29,int,!0,!0,!0) s:setDefault(!3q)||RequestorType
@5.ConnectException|c|!31|||
@5.ContentHandler|c|!1|a:getContent(!5g) getContent(!5g,!q[])||
@5.MalformedURLException|c|!h|||
@5.NoRouteToHostException|c|!31|||
@5.ProtocolException|c|!h|||
!5h|c|!1|a:connectFailed(@5.URI,!5i,!h) a:select(@5.URI) s:getDefault() s:of(@5.InetSocketAddress) s:setDefault(!5h)||
!5i|c|!1,!2|||
!31|c|!h|||
@5.SocketTimeoutException|c|!3f|||
@5.URISyntaxException|c|!p|getIndex() getInput() getReason()||
@5.URLStreamHandler|c|!1|p:a:openConnection(!13) p:equals(!13,!13) p:getDefaultPort() p:getHostAddress(!13) p:hashCode(!13) p:hostsEqual(!13,!13) p:openConnection(!13,@5.Proxy) p:parseURL(!13,!0,int,int) p:sameFile(!13,!13) p:setURL(!13,!0,!0,int,!0,!0) p:setURL(!13,!0,!0,int,!0,!0,!0,!0,!0) p:toExternalForm(!13)||
@5.UnknownHostException|c|!h|||
!5t|i|!2e,!2f|||
!4m|i|!1b|a:isOpen()||
@h.GatheringByteChannel|i|!2f|a:write(!a[]) a:write(!a[],int,int)||
@h.InterruptibleChannel|i|!4m|||
!2e|i|!4m|a:read(!a)||
@h.ScatteringByteChannel|i|!2e|a:read(!a[]) a:read(!a[],int,int)||
@h.SeekableByteChannel|i|!5t|a:position() a:position(long) a:size() a:truncate(long)||
!2f|i|!4m|a:write(!a)||
@l.DirectoryStream.Filter|i||a:accept(?)||
!5u|i||a:postVisitDirectory(?,!h) a:preVisitDirectory(?,!47) a:visitFile(?,!47) a:visitFileFailed(?,!h)||
@l.PathMatcher|i||a:matches(@l.Path)||
@l.SimpleFileVisitor|c|!1,!5u|||
!32|c|!p|||
@b.Key|i|!2|a:getAlgorithm() a:getEncoded() a:getFormat()|serialVersionUID|
!1s|i||a:equals(!1) a:getName() a:hashCode() a:toString() implies(@p.Subject)||
@b.PrivateKey|i|@b.Key,!5v||serialVersionUID|
@b.PrivilegedAction|i||a:run()||
@b.PrivilegedExceptionAction|i||a:run()||
!3r|i|@b.Key||serialVersionUID|
@j.CertificateException|c|!32|||
!5w|c|!1,!2|a:getEncoded() a:getPublicKey() a:verify(!3r) a:verify(!3r,!0) getType() p:writeReplace() verify(!3r,!5d)||CertificateRep
!u|c|!5w,!5j|a:checkValidity() a:checkValidity(@2.Date) a:getBasicConstraints() a:getIssuerDN() a:getIssuerUniqueID() a:getKeyUsage() a:getNotAfter() a:getNotBefore() a:getSerialNumber() a:getSigAlgName() a:getSigAlgOID() a:getSigAlgParams() a:getSignature() a:getSubjectDN() a:getSubjectUniqueID() a:getTBSCertificate() a:getVersion() getExtendedKeyUsage() getIssuerAlternativeNames() getIssuerX500Principal() getSubjectAlternativeNames() getSubjectX500Principal()||
!5j|i||a:getCriticalExtensionOIDs() a:getExtensionValue(!0) a:getNonCriticalExtensionOIDs() a:hasUnsupportedCriticalExtension()||
!z|i||a:getLong(!1c) a:isSupported(!1c) get(!1c) query(@a.TemporalQuery) range(!1c)||
!4v|i||a:adjustInto(!1m)||
!3c|i||a:addTo(!1m) a:get(!1k) a:getUnits() a:subtractFrom(!1m)||
!1c|i||a:adjustInto(?,long) a:getBaseUnit() a:getFrom(!z) a:getRangeUnit() a:isDateBased() a:isSupportedBy(!z) a:isTimeBased() a:range() a:rangeRefinedBy(!z) a:toString() getDisplayName(!1h) resolve(!2g,!z,@10.ResolverStyle)||
!1k|i||a:addTo(?,long) a:between(!1m,!1m) a:getDuration() a:isDateBased() a:isDurationEstimated() a:isTimeBased() a:toString() isSupportedBy(!1m)||
!1m|i|!z|a:isSupported(!1k) a:plus(long,!1k) a:until(!1m,!1k) a:with(!1c,long) minus(!3c) minus(long,!1k) plus(!3c) with(!4v)||
!v|c|!1,!b|||
!2r|c|!v,!3l|p:removeRange(int,int)|modCount|
@2.AbstractMap.SimpleEntry|c|!1,!28,!2|||
@2.AbstractMap.SimpleImmutableEntry|c|!1,!28,!2|||
!11|c|!1,!2g|||SimpleEntry SimpleImmutableEntry
!1d|c|!v,!4n|||
!3h|c|!2r|||
!2a|c|!v,!4e|||
@2.ArrayDeque|c|!v,!4o,!g,!2|||
@2.ArrayList|c|!2r,!3l,!2s,!g,!2|ensureCapacity(int) trimToSize()||
!b|i|!5c|a:add(?) a:addAll(!b) a:clear() a:contains(!1) a:containsAll(!b) a:equals(!1) a:hashCode() a:isEmpty() a:remove(!1) a:removeAll(!b) a:retainAll(!b) a:size() a:toArray() a:toArray(?) parallelStream() removeIf(!2t) stream() toArray(!5x)||
!s|i||a:compare(?,?) a:equals(!1) reversed() s:comparing(!5) s:comparing(!5,!s) s:comparingDouble(!10) s:comparingInt(!1e) s:comparingLong(!17) s:naturalOrder() s:nullsFirst(!s) s:nullsLast(!s) s:reverseOrder() thenComparing(!s) thenComparing(!5) thenComparing(!5,!s) thenComparingDouble(!10) thenComparingInt(!1e) thenComparingLong(!17)||
@2.ConcurrentModificationException|c|!4|||
!4o|i|!4n,!1n|a:descendingIterator() a:offerFirst(?) a:offerLast(?) a:peekFirst() a:peekLast() a:pollFirst() a:pollLast() a:pop() a:push(?) a:removeFirstOccurrence(!1) a:removeLastOccurrence(!1)||
!66|c|!1|a:elements() a:get(!1) a:isEmpty() a:keys() a:put(?,?) a:remove(!1) a:size()||
@2.EnumMap|c|!11,!2,!g|||
@2.Enumeration|i||a:hasMoreElements() a:nextElement() asIterator()||
!3m|i||||
@2.EventObject|c|!1,!2|getSource()|source|
@2.Formattable|i||a:formatTo(@2.Formatter,int,int,int)||
!6g|c|!11,!2g,!g,!2|s:newHashMap(int)||
!6h|c|!2a,!4e,!g,!2|s:newHashSet(int)||
!68|c|!66,!2g,!g,!2|contains(!1) p:rehash()||
@2.IdentityHashMap|c|!11,!2g,!2,!g|||
!5e|i||a:hasNext() a:next() forEachRemaining(!f) remove()||
@2.LinkedHashMap|c|!6g,!40|p:removeEldestEntry(!28) s:newLinkedHashMap(int)||
@2.LinkedHashSet|c|!6h,!41,!g,!2|s:newLinkedHashSet(int)||
@2.LinkedList|c|!3h,!3l,!4o,!g,!2|||
@2.ListIterator|i|!5e|a:add(?) a:hasPrevious() a:nextIndex() a:previous() a:previousIndex() a:set(?)||
@2.ListResourceBundle|c|!3d|p:a:getContents()||
!3l|i|!1n|a:add(int,?) a:addAll(int,!b) a:get(int) a:indexOf(!1) a:lastIndexOf(!1) a:listIterator() a:listIterator(int) a:remove(int) a:set(int,?) a:subList(int,int) replaceAll(!2j) s:copyOf(!b) s:of() s:of(?) s:of(?,?) s:of(?,?,?) s:of(?,?,?,?) s:of(?,?,?,?,?) s:of(?,?,?,?,?,?) s:of(?,?,?,?,?,?,?) s:of(?,?,?,?,?,?,?,?) s:of(?,?,?,?,?,?,?,?,?) s:of(?,?,?,?,?,?,?,?,?,?) s:of(?...) sort(!s)||
!28|i||a:equals(!1) a:getKey() a:getValue() a:hashCode() a:setValue(?) s:comparingByKey() s:comparingByKey(!s) s:comparingByValue() s:comparingByValue(!s) s:copyOf(!28)||
!2g|i||a:clear() a:containsKey(!1) a:containsValue(!1) a:entrySet() a:equals(!1) a:get(!1) a:hashCode() a:isEmpty() a:keySet() a:put(?,?) a:putAll(!2g) a:remove(!1) a:size() a:values() compute(?,!8) computeIfAbsent(?,!5) computeIfPresent(?,!8) forEach(!m) getOrDefault(!1,?) merge(?,?,!8) putIfAbsent(?,?) remove(!1,!1) replace(?,?) replace(?,?,?) replaceAll(!8) s:copyOf(!2g) s:entry(?,?) s:of() s:of(?,?) s:of(?,?,?,?) s:of(?,?,?,?,?,?) s:of(?,?,?,?,?,?,?,?) s:of(?,?,?,?,?,?,?,?,?,?) s:of(?,?,?,?,?,?,?,?,?,?,?,?) s:of(?,?,?,?,?,?,?,?,?,?,?,?,?,?) s:of(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) s:of(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) s:of(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) s:ofEntries(!28[]...)||Entry
@2.MissingResourceException|c|!4|getClassName() getKey()||
!42|i|!69|a:ceilingEntry(?) a:ceilingKey(?) a:descendingKeySet() a:descendingMap() a:floorEntry(?) a:floorKey(?) a:headMap(?,boolean) a:higherEntry(?) a:higherKey(?) a:lowerEntry(?) a:lowerKey(?) a:navigableKeySet() a:subMap(?,boolean,?,boolean) a:tailMap(?,boolean)||
!43|i|!6a|a:ceiling(?) a:descendingIterator() a:descendingSet() a:floor(?) a:headSet(?,boolean) a:higher(?) a:lower(?) a:pollFirst() a:pollLast() a:subSet(?,boolean,?,boolean) a:tailSet(?,boolean)||
@2.NoSuchElementException|c|!4|||
@2.Optional|C|!1|||
@2.PriorityQueue|c|!1d,!2|comparator()||
@2.Properties|c|!68|compute(!1,!8) computeIfAbsent(!1,!5) computeIfPresent(!1,!8) getOrDefault(!1,!1) getProperty(!0) getProperty(!0,!0) list(!4b) list(!4c) load(!1q) load(!30) loadFromXML(!1q) merge(!1,!1,!8) propertyNames() put(!1,!1) putIfAbsent(!1,!1) replace(!1,!1) replace(!1,!1,!1) save(!l,!0) setProperty(!0,!0) store(!l,!0) store(!24,!0) storeToXML(!l,!0) storeToXML(!l,!0,!0) storeToXML(!l,!0,!6f) stringPropertyNames()|defaults|
!4n|i|!b|a:element() a:offer(?) a:peek() a:poll() a:remove()||
!2s|i||||
@2.Random|c|!1,!33,!2|p:next(int) s:from(!33) setSeed(long)||
!3d|c|!1|a:getKeys() containsKey(!0) getBaseBundleName() getLocale() getObject(!0) getString(!0) getStringArray(!0) keySet() p:a:handleGetObject(!0) p:handleKeySet() p:setParent(!3d) s:clearCache() s:clearCache(!1a) s:getBundle(!0) s:getBundle(!0,!61) s:getBundle(!0,!1h) s:getBundle(!0,!1h,!1a) s:getBundle(!0,!1h,!1a,!23) s:getBundle(!0,!1h,!61) s:getBundle(!0,!1h,!23) s:getBundle(!0,!23)|parent|Control
!1n|i|!b|a:reversed() addFirst(?) addLast(?) getFirst() getLast() removeFirst() removeLast()||
!40|i|!2g|a:reversed() firstEntry() lastEntry() pollFirstEntry() pollLastEntry() putFirst(?,?) putLast(?,?) sequencedEntrySet() sequencedKeySet() sequencedValues()||
!41|i|!1n,!4e|||
!4e|i|!b|s:copyOf(!b) s:of() s:of(?) s:of(?,?) s:of(?,?,?) s:of(?,?,?,?) s:of(?,?,?,?,?) s:of(?,?,?,?,?,?) s:of(?,?,?,?,?,?,?) s:of(?,?,?,?,?,?,?,?) s:of(?,?,?,?,?,?,?,?,?) s:of(?,?,?,?,?,?,?,?,?,?) s:of(?...)||
!69|i|!40|a:comparator() a:firstKey() a:headMap(?) a:lastKey() a:subMap(?,?) a:tailMap(?)||
!6a|i|!4e,!41|a:comparator() a:first() a:headSet(?) a:last() a:subSet(?,?) a:tailSet(?)||
@2.Spliterators.AbstractSpliterator|c|!1,!5y|||
!5y|i||a:characteristics() a:estimateSize() a:tryAdvance(!f) a:trySplit() forEachRemaining(!f) getComparator() getExactSizeIfKnown() hasCharacteristics(int)|CONCURRENT DISTINCT IMMUTABLE NONNULL ORDERED SIZED SORTED SUBSIZED|OfDouble OfInt OfLong OfPrimitive
@2.Stack|c|@2.Vector|empty() peek() pop() push(?) search(!1)||
@2.TimerTask|c|!1,!7|cancel() scheduledExecutionTime()||
@2.TreeMap|c|!11,!42,!g,!2|||
@2.TreeSet|c|!2a,!43,!g,!2|||
@2.Vector|c|!2r,!3l,!2s,!g,!2|addElement(?) capacity() copyInto(!1[]) elementAt(int) elements() ensureCapacity(int) firstElement() indexOf(!1,int) insertElementAt(?,int) lastElement() lastIndexOf(!1,int) removeAllElements() removeElement(!1) removeElementAt(int) setElementAt(?,int) setSize(int) trimToSize()|capacityIncrement elementCount elementData|
@2.WeakHashMap|c|!11,!2g|s:newWeakHashMap(int)||
!3a|c|!1,!34|p:newTaskFor(!7,?) p:newTaskFor(!20)||
@4.ArrayBlockingQueue|c|!1d,!1w,!2|||
!5k|i|!1w,!4o|a:offerFirst(?,long,!9) a:offerLast(?,long,!9) a:pollFirst(long,!9) a:pollLast(long,!9) a:putFirst(?) a:putLast(?) a:takeFirst() a:takeLast()||
!1w|i|!4n|a:drainTo(!b) a:drainTo(!b,int) a:offer(?,long,!9) a:poll(long,!9) a:put(?) a:remainingCapacity() a:take()||
@4.BrokenBarrierException|c|!p|||
!20|i||a:call()||
@4.CancellationException|c|!3o|||
!2u|c|!1,!44,!6|complete(?) completeAsync(!1l) completeAsync(!1l,!d) completeExceptionally(!j) completeOnTimeout(?,long,!9) copy() defaultExecutor() getNow(?) getNumberOfDependents() isCompletedExceptionally() join() minimalCompletionStage() newIncompleteFuture() obtrudeException(!j) obtrudeValue(?) orTimeout(long,!9) s:allOf(!2u[]...) s:anyOf(!2u[]...) s:completedFuture(?) s:completedStage(?) s:delayedExecutor(long,!9) s:delayedExecutor(long,!9,!d) s:failedFuture(!j) s:failedStage(!j) s:runAsync(!7) s:runAsync(!7,!d) s:supplyAsync(!1l) s:supplyAsync(!1l,!d)||AsynchronousCompletionTask
@4.CompletionException|c|!4|||
!6|i||a:acceptEither(!6,!f) a:acceptEitherAsync(!6,!f) a:acceptEitherAsync(!6,!f,!d) a:applyToEither(!6,!5) a:applyToEitherAsync(!6,!5) a:applyToEitherAsync(!6,!5,!d) a:exceptionally(!5) a:handle(!8) a:handleAsync(!8) a:handleAsync(!8,!d) a:runAfterBoth(!6,!7) a:runAfterBothAsync(!6,!7) a:runAfterBothAsync(!6,!7,!d) a:runAfterEither(!6,!7) a:runAfterEitherAsync(!6,!7) a:runAfterEitherAsync(!6,!7,!d) a:thenAccept(!f) a:thenAcceptAsync(!f) a:thenAcceptAsync(!f,!d) a:thenAcceptBoth(!6,!m) a:thenAcceptBothAsync(!6,!m) a:thenAcceptBothAsync(!6,!m,!d) a:thenApply(!5) a:thenApplyAsync(!5) a:thenApplyAsync(!5,!d) a:thenCombine(!6,!8) a:thenCombineAsync(!6,!8) a:thenCombineAsync(!6,!8,!d) a:thenCompose(!5) a:thenComposeAsync(!5) a:thenComposeAsync(!5,!d) a:thenRun(!7) a:thenRunAsync(!7) a:thenRunAsync(!7,!d) a:toCompletableFuture() a:whenComplete(!m) a:whenCompleteAsync(!m) a:whenCompleteAsync(!m,!d) exceptionallyAsync(!5) exceptionallyAsync(!5,!d) exceptionallyCompose(!5) exceptionallyComposeAsync(!5) exceptionallyComposeAsync(!5,!d)||
@4.ConcurrentHashMap|c|!11,!3s,!2|contains(!1) elements() forEach(long,!m) forEach(long,!8,!f) forEachEntry(long,!f) forEachEntry(long,!5,!f) forEachKey(long,!f) forEachKey(long,!5,!f) forEachValue(long,!f) forEachValue(long,!5,!f) keySet(?) keys() mappingCount() reduce(long,!8,!8) reduceEntries(long,!8) reduceEntries(long,!5,!8) reduceEntriesToDouble(long,!10,double,!y) reduceEntriesToInt(long,!1e,int,!t) reduceEntriesToLong(long,!17,long,!o) reduceKeys(long,!8) reduceKeys(long,!5,!8) reduceKeysToDouble(long,!10,double,!y) reduceKeysToInt(long,!1e,int,!t) reduceKeysToLong(long,!17,long,!o) reduceToDouble(long,@1.ToDoubleBiFunction,double,!y) reduceToInt(long,!4y,int,!t) reduceToLong(long,@1.ToLongBiFunction,long,!o) reduceValues(long,!8) reduceValues(long,!5,!8) reduceValuesToDouble(long,!10,double,!y) reduceValuesToInt(long,!1e,int,!t) reduceValuesToLong(long,!17,long,!o) s:newKeySet() s:newKeySet(int) search(long,!8) searchEntries(long,!5) searchKeys(long,!5) searchValues(long,!5)||KeySetView
@4.ConcurrentLinkedDeque|c|!v,!4o,!2|||
@4.ConcurrentLinkedQueue|c|!1d,!4n,!2|||
!3s|i|!2g|||
!3i|i|!3s,!42|||
@4.ConcurrentSkipListMap|c|!11,!3i,!g,!2|||
@4.ConcurrentSkipListSet|c|!2a,!43,!g,!2|||
@4.CopyOnWriteArrayList|c|!1,!3l,!2s,!g,!2|addAllAbsent(!b) addIfAbsent(?) indexOf(?,int) lastIndexOf(?,int)||
@4.CopyOnWriteArraySet|c|!2a,!2|||
!2y|c|!15|a:compute() addToPendingCount(int) compareAndSetPendingCount(int,int) decrementPendingCountUnlessZero() firstComplete() getCompleter() getPendingCount() getRoot() helpComplete(int) nextComplete() onCompletion(!2y) onExceptionalCompletion(!j,!2y) propagateCompletion() quietlyCompleteRoot() setPendingCount(int) tryComplete()||
!6i|i|!c|a:getDelay(!9)||
@4.ExecutionException|c|!p|||
!34|i|!d,!1v|a:awaitTermination(long,!9) a:invokeAll(!b) a:invokeAll(!b,long,!9) a:invokeAny(!b) a:invokeAny(!b,long,!9) a:isShutdown() a:isTerminated() a:shutdown() a:shutdownNow() a:submit(!7) a:submit(!7,?) a:submit(!20)||
!d|i||a:execute(!7)||
@4.Flow.Processor|i|!35,!58|||
!58|i||a:subscribe(!35)||
!35|i||a:onComplete() a:onError(!j) a:onNext(?) a:onSubscribe(!4p)||
!4p|i||a:cancel() a:request(long)||
@4.Flow|c|!1|s:defaultBufferSize()||Processor Publisher Subscriber Subscription
!15|c|!1,!44,!2|a:getRawResult() compareAndSetForkJoinTaskTag(short,short) complete(?) completeExceptionally(!j) fork() getException() getForkJoinTaskTag() invoke() isCompletedAbnormally() isCompletedNormally() join() p:a:exec() p:a:setRawResult(?) quietlyComplete() quietlyInvoke() quietlyJoin() quietlyJoin(long,!9) quietlyJoinUninterruptibly(long,!9) reinitialize() s:adapt(!7) s:adapt(!7,?) s:adapt(!20) s:adaptInterruptible(!20) s:getPool() s:getQueuedTaskCount() s:getSurplusQueuedTaskCount() s:helpQuiesce() s:inForkJoinPool() s:invokeAll(!b) s:invokeAll(!15,!15) s:invokeAll(!15[]...) s:p:peekNextLocalTask() s:p:pollNextLocalTask() s:p:pollSubmission() s:p:pollTask() setForkJoinTaskTag(short) tryUnfork()||
@4.FutureTask|c|!1,!3e|p:done() p:runAndReset() p:set(?) p:setException(!j)||
!44|i||a:cancel(boolean) a:get() a:get(long,!9) a:isCancelled() a:isDone() exceptionNow() resultNow() state()||State
@4.LinkedBlockingDeque|c|!1d,!5k,!2|||
@4.LinkedBlockingQueue|c|!1d,!1w,!2|||
@4.RecursiveAction|c|!15|p:a:compute() p:setRawResult(@0.Void)||
@4.RecursiveTask|c|!15|p:a:compute()||
@4.RejectedExecutionException|c|!4|||
!36|i||a:rejectedExecution(!7,!2q)||
!3e|i|!7,!44|||
!1y|i|!3e,!4z|a:isPeriodic()||
!37|i|!34|a:schedule(!7,long,!9) a:schedule(!20,long,!9) a:scheduleAtFixedRate(!7,long,long,!9) a:scheduleWithFixedDelay(!7,long,long,!9)||
!4z|i|!6i,!44|||
@4.ScheduledThreadPoolExecutor|c|!2q,!37|getContinueExistingPeriodicTasksAfterShutdownPolicy() getExecuteExistingDelayedTasksAfterShutdownPolicy() getRemoveOnCancelPolicy() p:decorateTask(!7,!1y) p:decorateTask(!20,!1y) setContinueExistingPeriodicTasksAfterShutdownPolicy(boolean) setExecuteExistingDelayedTasksAfterShutdownPolicy(boolean) setRemoveOnCancelPolicy(boolean)||
!5l|i||a:newThread(!7)||
!2q|c|!3a|allowCoreThreadTimeOut(boolean) allowsCoreThreadTimeOut() getActiveCount() getCompletedTaskCount() getCorePoolSize() getKeepAliveTime(!9) getLargestPoolSize() getMaximumPoolSize() getPoolSize() getQueue() getRejectedExecutionHandler() getTaskCount() getThreadFactory() isTerminating() p:afterExecute(!7,!j) p:beforeExecute(!27,!7) p:terminated() prestartAllCoreThreads() prestartCoreThread() purge() remove(!7) setCorePoolSize(int) setKeepAliveTime(long,!9) setMaximumPoolSize(int) setRejectedExecutionHandler(!36) setThreadFactory(!5l)||AbortPolicy CallerRunsPolicy DiscardOldestPolicy DiscardPolicy
@4.TimeoutException|c|!p|||
@4.TransferQueue|i|!1w|a:getWaitingConsumerCount() a:hasWaitingConsumer() a:transfer(?) a:tryTransfer(?) a:tryTransfer(?,long,!9)||
@o.AtomicBoolean|c|!1,!2|compareAndExchange(boolean,boolean) compareAndExchangeAcquire(boolean,boolean) compareAndExchangeRelease(boolean,boolean) compareAndSet(boolean,boolean) get() getAcquire() getAndSet(boolean) getOpaque() getPlain() lazySet(boolean) set(boolean) setOpaque(boolean) setPlain(boolean) setRelease(boolean) weakCompareAndSet(boolean,boolean) weakCompareAndSetAcquire(boolean,boolean) weakCompareAndSetPlain(boolean,boolean) weakCompareAndSetRelease(boolean,boolean) weakCompareAndSetVolatile(boolean,boolean)||
@o.AtomicInteger|c|!19,!2|accumulateAndGet(int,!t) addAndGet(int) compareAndExchange(int,int) compareAndExchangeAcquire(int,int) compareAndExchangeRelease(int,int) compareAndSet(int,int) decrementAndGet() get() getAcquire() getAndAccumulate(int,!t) getAndAdd(int) getAndDecrement() getAndIncrement() getAndSet(int) getAndUpdate(!1g) getOpaque() getPlain() incrementAndGet() lazySet(int) set(int) setOpaque(int) setPlain(int) setRelease(int) updateAndGet(!1g) weakCompareAndSet(int,int) weakCompareAndSetAcquire(int,int) weakCompareAndSetPlain(int,int) weakCompareAndSetRelease(int,int) weakCompareAndSetVolatile(int,int)||
@o.AtomicLong|c|!19,!2|accumulateAndGet(long,!o) addAndGet(long) compareAndExchange(long,long) compareAndExchangeAcquire(long,long) compareAndExchangeRelease(long,long) compareAndSet(long,long) decrementAndGet() get() getAcquire() getAndAccumulate(long,!o) getAndAdd(long) getAndDecrement() getAndIncrement() getAndSet(long) getAndUpdate(!18) getOpaque() getPlain() incrementAndGet() lazySet(long) set(long) setOpaque(long) setPlain(long) setRelease(long) updateAndGet(!18) weakCompareAndSet(long,long) weakCompareAndSetAcquire(long,long) weakCompareAndSetPlain(long,long) weakCompareAndSetRelease(long,long) weakCompareAndSetVolatile(long,long)||
@o.AtomicReference|c|!1,!2|accumulateAndGet(?,!1p) compareAndExchange(?,?) compareAndExchangeAcquire(?,?) compareAndExchangeRelease(?,?) compareAndSet(?,?) get() getAcquire() getAndAccumulate(?,!1p) getAndSet(?) getAndUpdate(!2j) getOpaque() getPlain() lazySet(?) set(?) setOpaque(?) setPlain(?) setRelease(?) updateAndGet(!2j) weakCompareAndSet(?,?) weakCompareAndSetAcquire(?,?) weakCompareAndSetPlain(?,?) weakCompareAndSetRelease(?,?) weakCompareAndSetVolatile(?,?)||
!2v|c|!1,!2|p:getExclusiveOwnerThread() p:setExclusiveOwnerThread(!27)||
@e.AbstractQueuedSynchronizer|c|!2v,!2|acquire(int) acquireInterruptibly(int) acquireShared(int) acquireSharedInterruptibly(int) getExclusiveQueuedThreads() getFirstQueuedThread() getQueueLength() getQueuedThreads() getSharedQueuedThreads() getWaitQueueLength(!k) getWaitingThreads(!k) hasContended() hasQueuedPredecessors() hasQueuedThreads() hasWaiters(!k) isQueued(!27) owns(!k) p:compareAndSetState(int,int) p:getState() p:isHeldExclusively() p:setState(int) p:tryAcquire(int) p:tryAcquireShared(int) p:tryRelease(int) p:tryReleaseShared(int) release(int) releaseShared(int) tryAcquireNanos(int,long) tryAcquireSharedNanos(int,long)||ConditionObject
!1t|i||a:await() a:await(long,!9) a:awaitNanos(long) a:awaitUninterruptibly() a:awaitUntil(@2.Date) a:signal() a:signalAll()||
@e.Lock|i||a:lock() a:lockInterruptibly() a:newCondition() a:tryLock() a:tryLock(long,!9) a:unlock()||
!5m|i||a:readLock() a:writeLock()||
@e.ReentrantLock|c|!1,@e.Lock,!2|getHoldCount() getQueueLength() getWaitQueueLength(!1t) hasQueuedThread(!27) hasQueuedThreads() hasWaiters(!1t) isFair() isHeldByCurrentThread() isLocked() p:getOwner() p:getQueuedThreads() p:getWaitingThreads(!1t)||
@e.ReentrantReadWriteLock|c|!1,!5m,!2|getQueueLength() getReadHoldCount() getReadLockCount() getWaitQueueLength(!1t) getWriteHoldCount() hasQueuedThread(!27) hasQueuedThreads() hasWaiters(!1t) isFair() isWriteLocked() isWriteLockedByCurrentThread() p:getOwner() p:getQueuedReaderThreads() p:getQueuedThreads() p:getQueuedWriterThreads() p:getWaitingThreads(!1t)||ReadLock WriteLock
!m|i||a:accept(?,?) andThen(!m)||
!8|i||a:apply(?,?) andThen(!5)||
!4f|i||a:test(?,?) and(!4f) negate() or(!4f)||
!1p|i|!8|s:maxBy(!s) s:minBy(!s)||
@1.BooleanSupplier|i||a:getAsBoolean()||
!f|i||a:accept(?) andThen(!f)||
!y|i||a:applyAsDouble(double,double)||
!59|i||a:accept(double) andThen(!59)||
@1.DoubleFunction|i||a:apply(double)||
!38|i||a:test(double) and(!38) negate() or(!38)||
@1.DoubleSupplier|i||a:getAsDouble()||
@1.DoubleToIntFunction|i||a:applyAsInt(double)||
!2h|i||a:applyAsDouble(double) andThen(!2h) compose(!2h) s:identity()||
!5|i||a:apply(?) andThen(!5) compose(!5) s:identity()||
!t|i||a:applyAsInt(int,int)||
!5z|i||a:accept(int) andThen(!5z)||
!5x|i||a:apply(int)||
!45|i||a:test(int) and(!45) negate() or(!45)||
@1.IntSupplier|i||a:getAsInt()||
@1.IntToDoubleFunction|i||a:applyAsDouble(int)||
@1.IntToLongFunction|i||a:applyAsLong(int)||
!1g|i||a:applyAsInt(int) andThen(!1g) compose(!1g) s:identity()||
!o|i||a:applyAsLong(long,long)||
!5p|i||a:accept(long) andThen(!5p)||
@1.LongFunction|i||a:apply(long)||
!3t|i||a:test(long) and(!3t) negate() or(!3t)||
@1.LongSupplier|i||a:getAsLong()||
@1.LongToIntFunction|i||a:applyAsInt(long)||
!18|i||a:applyAsLong(long) andThen(!18) compose(!18) s:identity()||
@1.ObjDoubleConsumer|i||a:accept(?,double)||
@1.ObjIntConsumer|i||a:accept(?,int)||
@1.ObjLongConsumer|i||a:accept(?,long)||
!2t|i||a:test(?) and(!2t) negate() or(!2t) s:isEqual(!1) s:not(!2t)||
!1l|i||a:get()||
!10|i||a:applyAsDouble(?)||
!4y|i||a:applyAsInt(?,?)||
!1e|i||a:applyAsInt(?)||
!17|i||a:applyAsLong(?)||
!2j|i|!5|s:identity()||
@i.Filter|i||a:isLoggable(!2w)||
!6b|c|!1|a:format(!2w) formatMessage(!2w) getHead(!5q) getTail(!5q)||
!5q|c|!1|a:close() a:flush() a:publish(!2w) getEncoding() getErrorManager() getFilter() getFormatter() getLevel() isLoggable(!2w) p:reportError(!0,!p,int) setEncoding(!0) setErrorManager(@i.ErrorManager) setFilter(@i.Filter) setFormatter(!6b) setLevel(@i.Level)||
!33|i||a:nextLong() doubles() doubles(double,double) doubles(long) doubles(long,double,double) ints() ints(int,int) ints(long) ints(long,int,int) isDeprecated() longs() longs(long) longs(long,long) longs(long,long,long) nextBoolean() nextBytes(byte[]) nextDouble() nextDouble(double) nextDouble(double,double) nextExponential() nextFloat() nextFloat(float) nextFloat(float,float) nextGaussian() nextGaussian(double,double) nextInt() nextInt(int) nextInt(int,int) nextLong(long) nextLong(long,long) s:getDefault() s:of(!0)||ArbitrarilyJumpableGenerator JumpableGenerator LeapableGenerator SplittableGenerator StreamableGenerator
@r.Collector|i||a:accumulator() a:characteristics() a:combiner() a:finisher() a:supplier() s:of(!1l,!m,!1p,!5,!2z[]...) s:of(!1l,!m,!1p,!2z[]...)||Characteristics
@11.Checksum|i||a:getValue() a:reset() a:update(byte[],int,int) a:update(int) update(byte[]) update(!a)||
@n.AbstractProcessor|c|!1,!6c|p:isInitialized()|processingEnv|
!6c|i||a:getCompletions(!2b,!4w,!4q,!0) a:getSupportedAnnotationTypes() a:getSupportedOptions() a:getSupportedSourceVersion() a:init(@n.ProcessingEnvironment) a:process(!4e,@n.RoundEnvironment)||
!3j|i||a:visit(!39,?) a:visitAnnotation(!4w,?) a:visitArray(!3l,?) a:visitBoolean(boolean,?) a:visitByte(byte,?) a:visitChar(char,?) a:visitDouble(double,?) a:visitEnumConstant(!50,?) a:visitFloat(float,?) a:visitInt(int,?) a:visitLong(long,?) a:visitShort(short,?) a:visitString(!0,?) a:visitType(!2i,?) a:visitUnknown(!39,?) visit(!39)||
!5a|i||a:visit(!2b,?) a:visitExecutable(!4q,?) a:visitPackage(@c.PackageElement,?) a:visitType(@c.TypeElement,?) a:visitTypeParameter(@c.TypeParameterElement,?) a:visitUnknown(!2b,?) a:visitVariable(!50,?) visit(!2b) visitModule(@c.ModuleElement,?) visitRecordComponent(@c.RecordComponentElement,?)||
!60|i||a:visit(!2i,?) a:visitArray(@g.ArrayType,?) a:visitDeclared(@g.DeclaredType,?) a:visitError(@g.ErrorType,?) a:visitExecutable(@g.ExecutableType,?) a:visitIntersection(@g.IntersectionType,?) a:visitNoType(@g.NoType,?) a:visitNull(@g.NullType,?) a:visitPrimitive(@g.PrimitiveType,?) a:visitTypeVariable(@g.TypeVariable,?) a:visitUnion(@g.UnionType,?) a:visitUnknown(!2i,?) a:visitWildcard(@g.WildcardType,?) visit(!2i)||
!2c|c|!1,!3j|||
!1z|c|!1,!5a|||
!3y|c|!1,!60|||
@6.ElementScanner14|c|!51|||
!52|c|!1z|scan(!5c,?) scan(!2b) scan(!2b,?)|DEFAULT_VALUE|
!53|c|!52|||
!54|c|!53|||
!51|c|!54|||
@6.SimpleAnnotationValueVisitor14|c|!2k|||
!2l|c|!2c|p:defaultAction(!1,?)|DEFAULT_VALUE|
!2m|c|!2l|||
!2n|c|!2m|||
!2k|c|!2n|||
@6.SimpleElementVisitor14|c|!3u|||
!3v|c|!1z|p:defaultAction(!2b,?)|DEFAULT_VALUE|
!3w|c|!3v|||
!3x|c|!3w|||
!3u|c|!3x|||
@6.SimpleTypeVisitor14|c|!4g|||
!4h|c|!3y|p:defaultAction(!2i,?)|DEFAULT_VALUE|
!4i|c|!4h|||
!4j|c|!4i|||
!4g|c|!4j|||
@s.DynamicMBean|i||a:getAttribute(!0) a:getAttributes(!0[]) a:getMBeanInfo() a:invoke(!0,!1[],!0[]) a:setAttribute(@s.Attribute) a:setAttributes(@s.AttributeList)||
@7.ExtendedSSLSession|c|!1,!4s|a:getLocalSupportedSignatureAlgorithms() a:getPeerSupportedSignatureAlgorithms() getRequestedServerNames() getStatusResponses()||
@7.HostnameVerifier|i||a:verify(!0,!4s)||
@7.KeyManagerFactorySpi|c|!1|p:a:engineGetKeyManagers() p:a:engineInit(!48,char[]) p:a:engineInit(!14)||
@7.KeyManagerFactory|c|!1|getAlgorithm() getKeyManagers() getProvider() init(!48,char[]) init(!14) s:getDefaultAlgorithm() s:getInstance(!0) s:getInstance(!0,!0) s:getInstance(!0,!5d)||
!4t|i||||
@7.SSLContextSpi|c|!1|p:a:engineCreateSSLEngine() p:a:engineCreateSSLEngine(!0,int) p:a:engineGetClientSessionContext() p:a:engineGetServerSessionContext() p:a:engineGetServerSocketFactory() p:a:engineGetSocketFactory() p:a:engineInit(!4t[],!46[],@b.SecureRandom) p:engineGetDefaultSSLParameters() p:engineGetSupportedSSLParameters()||
!2x|c|!1|a:beginHandshake() a:closeInbound() a:closeOutbound() a:getDelegatedTask() a:getEnableSessionCreation() a:getEnabledCipherSuites() a:getEnabledProtocols() a:getHandshakeStatus() a:getNeedClientAuth() a:getSession() a:getSupportedCipherSuites() a:getSupportedProtocols() a:getUseClientMode() a:getWantClientAuth() a:isInboundDone() a:isOutboundDone() a:setEnableSessionCreation(boolean) a:setEnabledCipherSuites(!0[]) a:setEnabledProtocols(!0[]) a:setNeedClientAuth(boolean) a:setUseClientMode(boolean) a:setWantClientAuth(boolean) a:unwrap(!a,!a[],int,int) a:wrap(!a[],int,int,!a) getApplicationProtocol() getHandshakeApplicationProtocol() getHandshakeApplicationProtocolSelector() getHandshakeSession() getPeerHost() getPeerPort() getSSLParameters() setHandshakeApplicationProtocolSelector(!8) setSSLParameters(@7.SSLParameters) unwrap(!a,!a) unwrap(!a,!a[]) wrap(!a,!a) wrap(!a[],!a)||
!5r|c|!h|||
@7.SSLHandshakeException|c|!5r|||
@7.SSLSessionBindingListener|i|!3m|a:valueBound(!3k) a:valueUnbound(!3k)||
@7.SSLSessionContext|i||a:getIds() a:getSession(byte[]) a:getSessionCacheSize() a:getSessionTimeout() a:setSessionCacheSize(int) a:setSessionTimeout(int)||
!4s|i||a:getApplicationBufferSize() a:getCipherSuite() a:getCreationTime() a:getId() a:getLastAccessedTime() a:getLocalCertificates() a:getLocalPrincipal() a:getPacketBufferSize() a:getPeerCertificates() a:getPeerHost() a:getPeerPort() a:getPeerPrincipal() a:getProtocol() a:getSessionContext() a:getValue(!0) a:getValueNames() a:invalidate() a:isValid() a:putValue(!0,!1) a:removeValue(!0) getPeerCertificateChain()||
@7.TrustManagerFactorySpi|c|!1|p:a:engineGetTrustManagers() p:a:engineInit(!48) p:a:engineInit(!14)||
@7.TrustManagerFactory|c|!1|getAlgorithm() getProvider() getTrustManagers() init(!48) init(!14) s:getDefaultAlgorithm() s:getInstance(!0) s:getInstance(!0,!0) s:getInstance(!0,!5d)||
!46|i||||
@7.X509ExtendedKeyManager|c|!1,!5b|chooseEngineClientAlias(!0[],!1s[],!2x) chooseEngineServerAlias(!0,!1s[],!2x)||
@7.X509ExtendedTrustManager|c|!1,!4x|a:checkClientTrusted(!u[],!0,!55) a:checkClientTrusted(!u[],!0,!2x) a:checkServerTrusted(!u[],!0,!55) a:checkServerTrusted(!u[],!0,!2x)||
!5b|i|!4t|a:chooseClientAlias(!0[],!1s[],!55) a:chooseServerAlias(!0,!1s[],!55) a:getCertificateChain(!0) a:getClientAliases(!0,!1s[]) a:getPrivateKey(!0) a:getServerAliases(!0,!1s[])||
!4x|i|!46|a:checkClientTrusted(!u[],!0) a:checkServerTrusted(!u[],!0) a:getAcceptedIssuers()||
!5v|i||destroy() isDestroyed()||
!x|i||a:delete() a:getCharContent(boolean) a:getLastModified() a:getName() a:openInputStream() a:openOutputStream() a:openReader(boolean) a:openWriter() a:toUri()||
@8.ForwardingJavaFileManager|c|!1,!56||fileManager|
!56|i|!1b,!3n,!5n|a:getClassLoader(!3) a:getFileForInput(!3,!0,!0) a:getFileForOutput(!3,!0,!0,!x) a:getJavaFileForInput(!3,!0,!1o) a:getJavaFileForOutput(!3,!0,!1o,!x) a:handleOption(!0,!5e) a:hasLocation(!3) a:inferBinaryName(!3,!2d) a:isSameFile(!x,!x) a:list(!3,!0,!4e,boolean) contains(!3,!x) getFileForOutputForOriginatingFiles(!3,!0,!0,!x[]...) getJavaFileForOutputForOriginatingFiles(!3,!0,!1o,!x[]...) getLocationForModule(!3,!0) getLocationForModule(!3,!2d) getServiceLoader(!3,!q) inferModuleName(!3) listLocationsForModules(!3)||Location
!2d|i|!x|a:getAccessLevel() a:getKind() a:getNestingKind() a:isNameCompatible(!0,!1o)||Kind
!5n|i||a:isSupportedOption(!0)||
@8.SimpleJavaFileObject|c|!1,!2d||kind uri|`;

/**
 * The packages outside java.* that JDK 21.0.12.1's modules export, by the
 * package around each: `javax.swing.plaf|basic metal multi nimbus synth`.
 * A build takes their types from the JDK, whatever a source root holds.
 */
export const JDK_EXPORTS = String.raw`com.sun.java.accessibility|util
com.sun|jdi management
com.sun.jdi|connect event request
com.sun.jdi.connect|spi
com.sun.net|httpserver
com.sun.net.httpserver|spi
com.sun.nio|file sctp
com.sun.security|auth jgss
com.sun.security.auth|callback login module
com.sun.source|doctree tree util
com.sun.tools|attach javac jconsole
com.sun.tools.attach|spi
javax|accessibility crypto imageio management naming net print script smartcardio sql swing tools xml
javax.annotation|processing
javax.crypto|interfaces spec
javax.imageio|event metadata spi stream
javax.imageio.plugins|bmp jpeg tiff
javax.lang|model
javax.lang.model|element type util
javax.management|loading modelmbean monitor openmbean relation remote timer
javax.management.remote|rmi
javax.naming|directory event ldap spi
javax.naming.ldap|spi
javax.net|ssl
javax.print|attribute event
javax.print.attribute|standard
javax.rmi|ssl
javax.security|auth cert sasl
javax.security.auth|callback kerberos login spi x500
javax.sound|midi sampled
javax.sound.midi|spi
javax.sound.sampled|spi
javax.sql|rowset
javax.sql.rowset|serial spi
javax.swing|border colorchooser event filechooser plaf table text tree undo
javax.swing.plaf|basic metal multi nimbus synth
javax.swing.text|html rtf
javax.swing.text.html|parser
javax.transaction|xa
javax.xml|catalog crypto datatype namespace parsers stream transform validation xpath
javax.xml.crypto|dom dsig
javax.xml.crypto.dsig|dom keyinfo spec
javax.xml.stream|events util
javax.xml.transform|dom sax stax stream
jdk|dynalink jfr jshell net nio
jdk.dynalink|beans linker support
jdk.dynalink.linker|support
jdk.incubator|vector
jdk.javadoc|doclet
jdk.jfr|consumer
jdk.jshell|execution spi tool
jdk.management|jfr
jdk.nio|mapmode
jdk.security|jarsigner
jdk.swing|interop
netscape|javascript
org.ietf|jgss
org.w3c|dom
org.w3c.dom|bootstrap css events html ls ranges stylesheets traversal views xpath
org.xml|sax
org.xml.sax|ext helpers
sun|misc reflect`;
