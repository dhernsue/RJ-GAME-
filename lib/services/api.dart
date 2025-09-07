import 'package:http/http.dart' as http;
import 'dart:convert';

class ApiService {
  final String baseUrl;
  ApiService(this.baseUrl);

  Future<Map> createOrder(String token, double amount) async {
    final res = await http.post(Uri.parse('$baseUrl/api/create-order'),
        headers: {'Authorization': 'Bearer \$token', 'Content-Type': 'application/json'},
        body: jsonEncode({'amount': amount}));
    return jsonDecode(res.body);
  }

  Future<Map> wallet(String token) async {
    final res = await http.get(Uri.parse('$baseUrl/api/wallet'), headers: {'Authorization': 'Bearer \$token'});
    return jsonDecode(res.body);
  }
}
