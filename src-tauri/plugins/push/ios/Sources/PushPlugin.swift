import Foundation
import ObjectiveC
import SwiftRs
import Tauri
import UIKit
import UserNotifications
import WebKit

private let allowedRoutes: Set<String> = ["file-detail", "hearings", "deadlines", "tasks"]
private let navigationStoreKey = "bkt_push_navigation"
private let tokenTimeoutSeconds: TimeInterval = 15

private struct TokenPayload: Encodable {
  let token: String
  let platform: String
  let environment: String
}

private struct PermissionPayload: Encodable {
  let granted: Bool
}

private struct NavigationPayload: Codable {
  let route: String
  let fileId: String?
  let hearingId: String?
  let view: String?
  let date: String?

  init?(userInfo: [AnyHashable: Any]) {
    func value(_ key: String) -> String? {
      (userInfo["bkt_push_\(key)"] as? String) ?? (userInfo[key] as? String)
    }
    guard let route = value("route"), allowedRoutes.contains(route) else { return nil }
    self.route = route
    fileId = value("file_id")
    hearingId = value("hearing_id")
    view = value("view")
    date = value("date")
  }

  var jsObject: JSObject {
    var object: JSObject = ["route": route]
    if let fileId { object["fileId"] = fileId }
    if let hearingId { object["hearingId"] = hearingId }
    if let view { object["view"] = view }
    if let date { object["date"] = date }
    return object
  }
}

private struct EmptyPayload: Encodable {}

/// APNs bildirim eklentisi. Android tarafındaki PushPlugin ile aynı komutları sunar;
/// Firebase yerine Apple'ın kendi APNs cihaz jetonunu döndürür.
class PushPlugin: Plugin, UNUserNotificationCenterDelegate {
  private static weak var current: PushPlugin?
  /// UIApplicationMain'in oluşturduğu temsilcinin tek güçlü sahibi UIKit'tir ve `delegate = nil`
  /// ataması onu serbest bırakır. Yeniden atama boyunca ve sonrasında nesneyi canlı tutar.
  private static var retainedApplicationDelegate: UIApplicationDelegate?

  /// TestFlight ve App Store derlemelerinde embedded.mobileprovision bulunmaz; bu durumda üretim APNs ortamı kullanılır.
  private static let apnsEnvironment: String = {
    guard let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
          let data = try? Data(contentsOf: url),
          let text = String(data: data, encoding: .isoLatin1) else { return "production" }
    let pattern = "<key>aps-environment</key>\\s*<string>development</string>"
    return text.range(of: pattern, options: .regularExpression) != nil ? "sandbox" : "production"
  }()

  private var deviceToken: String?
  private var tokenWaiters: [Invoke] = []
  private var delegateHooksInstalled = false

  override init() {
    super.init()
    PushPlugin.current = self
    UNUserNotificationCenter.current().delegate = self
  }

  @objc public override func load(webview: WKWebView) {
    DispatchQueue.main.async {
      self.installApplicationDelegateHooks()
      UIApplication.shared.registerForRemoteNotifications()
    }
  }

  // MARK: Komutlar

  @objc public func getToken(_ invoke: Invoke) {
    DispatchQueue.main.async {
      if let token = self.deviceToken {
        invoke.resolve(TokenPayload(token: token, platform: "ios", environment: PushPlugin.apnsEnvironment))
        return
      }
      self.tokenWaiters.append(invoke)
      self.installApplicationDelegateHooks()
      UIApplication.shared.registerForRemoteNotifications()
      DispatchQueue.main.asyncAfter(deadline: .now() + tokenTimeoutSeconds) {
        guard let index = self.tokenWaiters.firstIndex(where: { $0 === invoke }) else { return }
        self.tokenWaiters.remove(at: index)
        invoke.reject("APNs token unavailable")
      }
    }
  }

  @objc public func getPermissionState(_ invoke: Invoke) {
    UNUserNotificationCenter.current().getNotificationSettings { settings in
      invoke.resolve(PermissionPayload(granted: PushPlugin.isGranted(settings.authorizationStatus)))
    }
  }

  @objc public func requestNotificationPermission(_ invoke: Invoke) {
    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
      if let error {
        invoke.reject(error.localizedDescription)
        return
      }
      DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }
      invoke.resolve(PermissionPayload(granted: granted))
    }
  }

  @objc public func getPendingNavigation(_ invoke: Invoke) {
    if let navigation = takeStoredNavigation() {
      invoke.resolve(navigation)
    } else {
      invoke.resolve(EmptyPayload())
    }
  }

  // MARK: UNUserNotificationCenterDelegate

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    if #available(iOS 14.0, *) {
      completionHandler([.banner, .list, .sound])
    } else {
      completionHandler([.alert, .sound])
    }
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    if let navigation = NavigationPayload(userInfo: response.notification.request.content.userInfo) {
      storeNavigation(navigation)
      trigger("navigation", data: navigation.jsObject)
    }
    completionHandler()
  }

  // MARK: APNs jetonu

  fileprivate func didRegister(deviceToken data: Data) {
    let token = data.map { String(format: "%02x", $0) }.joined()
    let changed = deviceToken != nil && deviceToken != token
    deviceToken = token
    let payload = TokenPayload(token: token, platform: "ios", environment: PushPlugin.apnsEnvironment)
    let waiters = tokenWaiters
    tokenWaiters.removeAll()
    waiters.forEach { $0.resolve(payload) }
    if changed { trigger("tokenRefreshed", data: JSObject()) }
  }

  fileprivate func didFailToRegister(error: Error) {
    let waiters = tokenWaiters
    tokenWaiters.removeAll()
    waiters.forEach { $0.reject("APNs registration failed: \(error.localizedDescription)") }
  }

  /// Tauri uygulama temsilcisi APNs geri çağrılarını uygulamaz. Bu iki metodu çalışma anında ekler,
  /// mevcut bir uygulama varsa önce onu çağırır.
  private func installApplicationDelegateHooks() {
    guard !delegateHooksInstalled, let delegate = UIApplication.shared.delegate else { return }
    delegateHooksInstalled = true
    let delegateClass: AnyClass = type(of: delegate)

    typealias RegisterFunction = @convention(c) (AnyObject, Selector, UIApplication, NSData) -> Void
    let registerSelector = NSSelectorFromString("application:didRegisterForRemoteNotificationsWithDeviceToken:")
    let registerMethod = class_getInstanceMethod(delegateClass, registerSelector)
    let originalRegister = registerMethod.map { unsafeBitCast(method_getImplementation($0), to: RegisterFunction.self) }
    let registerBlock: @convention(block) (AnyObject, UIApplication, NSData) -> Void = { receiver, application, token in
      originalRegister?(receiver, registerSelector, application, token)
      PushPlugin.current?.didRegister(deviceToken: token as Data)
    }
    let registerImplementation = imp_implementationWithBlock(unsafeBitCast(registerBlock, to: AnyObject.self))
    if let registerMethod {
      method_setImplementation(registerMethod, registerImplementation)
    } else {
      class_addMethod(delegateClass, registerSelector, registerImplementation, "v@:@@")
    }

    typealias FailFunction = @convention(c) (AnyObject, Selector, UIApplication, NSError) -> Void
    let failSelector = NSSelectorFromString("application:didFailToRegisterForRemoteNotificationsWithError:")
    let failMethod = class_getInstanceMethod(delegateClass, failSelector)
    let originalFail = failMethod.map { unsafeBitCast(method_getImplementation($0), to: FailFunction.self) }
    let failBlock: @convention(block) (AnyObject, UIApplication, NSError) -> Void = { receiver, application, error in
      originalFail?(receiver, failSelector, application, error)
      PushPlugin.current?.didFailToRegister(error: error)
    }
    let failImplementation = imp_implementationWithBlock(unsafeBitCast(failBlock, to: AnyObject.self))
    if let failMethod {
      method_setImplementation(failMethod, failImplementation)
    } else {
      class_addMethod(delegateClass, failSelector, failImplementation, "v@:@@")
    }

    // UIApplication, temsilcinin hangi metodlara yanıt verdiğini atama anında önbelleğe alır;
    // yeniden atama yeni eklenen metodların görülmesini sağlar. `delegate = nil` UIKit'in tuttuğu
    // referansı bıraktığı için nesne önce kalıcı olarak sahiplenilir; aksi halde serbest kalır ve
    // UIKit'in sonraki erişimi uygulamayı çökertir (EXC_BAD_ACCESS, objc_retain).
    PushPlugin.retainedApplicationDelegate = delegate
    let application = UIApplication.shared
    application.delegate = nil
    application.delegate = delegate
  }

  // MARK: Bekleyen yönlendirme

  private func storeNavigation(_ navigation: NavigationPayload) {
    if let data = try? JSONEncoder().encode(navigation) {
      UserDefaults.standard.set(data, forKey: navigationStoreKey)
    }
  }

  private func takeStoredNavigation() -> NavigationPayload? {
    guard let data = UserDefaults.standard.data(forKey: navigationStoreKey) else { return nil }
    UserDefaults.standard.removeObject(forKey: navigationStoreKey)
    return try? JSONDecoder().decode(NavigationPayload.self, from: data)
  }

  private static func isGranted(_ status: UNAuthorizationStatus) -> Bool {
    switch status {
    case .authorized, .provisional, .ephemeral:
      return true
    default:
      return false
    }
  }
}

@_cdecl("init_plugin_push")
func initPlugin() -> Plugin {
  return PushPlugin()
}
